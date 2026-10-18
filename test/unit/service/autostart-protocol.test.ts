/**
 * A daemon still running older code (same package version, older graph RPC
 * method set — e.g. no Phase 8 `replaceFile`) must not be reused: clients
 * would get "Unknown graph method". Phase 12 review H2: it must not be
 * stopped either — two FlowLens versions used to kill each other's daemon.
 * Each protocol has its own `daemon-p<key>.json`; other daemons are only
 * listed, and stopped only by `daemon stop --all` when idle.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { GRAPH_READ_METHODS, GRAPH_RPC_PROTOCOL, GRAPH_WRITE_METHODS } from '../../../src/contracts/service.js';
import { findDaemon } from '../../../src/service/autostart.js';
import { daemonInfoPath, OWN_PROTOCOL_KEY, protocolKey, writeDaemonInfo } from '../../../src/service/daemon-info.js';
import { listKnownDaemons, stopKnownDaemons } from '../../../src/service/known-daemons.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { FLOWLENS_VERSION } from '../../../src/service/runtime.js';
import { restoreEnv, startHarness, type Harness } from '../../helpers/daemon-harness.js';
import { removeDir, tempDir } from '../../helpers/service-env.js';

/** Minimal fake daemon in a child process: answers ping with `pong`, exits on /api/shutdown. */
function fakeDaemon(pong: Record<string, unknown>, leases = 0): Promise<{ child: ChildProcess; port: number }> {
  const src = `
    const http = require('node:http');
    const pong = ${JSON.stringify(pong)};
    const srv = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/shutdown') { res.end('{"ok":true}'); srv.close(); setImmediate(() => process.exit(0)); return; }
      if (req.url === '/api/projects') { res.end(JSON.stringify([{ id: 'p', name: 'p', graph: { leases: ${leases} } }])); return; }
      res.end(JSON.stringify({ ...pong, pid: process.pid }));
    });
    srv.listen(0, '127.0.0.1', () => process.stdout.write(String(srv.address().port) + '\\n'));`;
  const child = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    child.stdout!.once('data', (d: Buffer) => resolve({ child, port: Number(String(d).trim()) }));
    child.once('error', reject);
  });
}

describe('daemon protocol handshake', () => {
  let home: string | null = null;
  let child: ChildProcess | null = null;
  let harness: Harness | null = null;
  const outerHome = process.env.FLOWLENS_HOME;

  afterEach(async () => {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    child = null;
    await harness?.stop();
    harness = null;
    if (home) await removeDir(home);
    home = null;
    restoreEnv('FLOWLENS_HOME', outerHome);
  });

  it('fingerprints every graph RPC method', () => {
    for (const m of [...GRAPH_READ_METHODS, ...GRAPH_WRITE_METHODS]) expect(GRAPH_RPC_PROTOCOL.split(',')).toContain(m);
    expect(GRAPH_RPC_PROTOCOL.split(',')).toContain('replaceFile');
  });

  it('a live daemon reports the current protocol and is reused', async () => {
    harness = await startHarness();
    const found = await findDaemon();
    expect(found).not.toBeNull();
    expect((await found!.ping())!.protocol).toBe(GRAPH_RPC_PROTOCOL);
    found!.destroy();
  });

  it('ignores, and never stops, a daemon in its info file whose ping has no protocol (pre-Phase-8 code)', async () => {
    home = await tempDir('flowlens-home-');
    process.env.FLOWLENS_HOME = home;
    const fake = await fakeDaemon({ ok: true, version: FLOWLENS_VERSION, uptime_ms: 1 });
    child = fake.child;
    writeDaemonInfo({
      pid: child.pid!, host: '127.0.0.1', port: fake.port, token: 't', version: FLOWLENS_VERSION, started_at: new Date().toISOString(),
    });
    expect(await findDaemon()).toBeNull();
    await sleep(200);
    expect(child.exitCode).toBeNull();
  });

  it('other versions get their own info file; stop --all only stops them when idle', async () => {
    home = await tempDir('flowlens-home-');
    process.env.FLOWLENS_HOME = home;
    const otherKey = protocolKey('0.0.1-other');
    expect(otherKey).not.toBe(OWN_PROTOCOL_KEY);
    expect(daemonInfoPath(otherKey)).not.toBe(daemonInfoPath());
    const busy = await fakeDaemon({ ok: true, version: '0.0.1-other', uptime_ms: 1, protocol: 'x' }, 2);
    child = busy.child;
    writeDaemonInfo({
      pid: child.pid!, host: '127.0.0.1', port: busy.port, token: 't', version: '0.0.1-other',
      started_at: new Date().toISOString(), protocol_key: otherKey,
    });
    expect(await findDaemon()).toBeNull();
    const known = await listKnownDaemons();
    expect(known).toHaveLength(1);
    expect(known[0]).toMatchObject({ own: false, alive: true, compatible: false, leases: 2 });

    // Plain `stop` never touches it; `--all` leaves it alone while clients use it.
    expect(await stopKnownDaemons({ all: false })).toEqual([]);
    expect((await stopKnownDaemons({ all: true }))[0].result).toBe('skipped_in_use');
    expect(child.exitCode).toBeNull();
    const exited = once(child, 'exit');
    expect((await stopKnownDaemons({ all: true, force: true }))[0].result).toBe('stopped');
    await exited;
  });

  it('a legacy daemon.json is listed but never used to connect', async () => {
    home = await tempDir('flowlens-home-');
    process.env.FLOWLENS_HOME = home;
    const fake = await fakeDaemon({ ok: true, version: FLOWLENS_VERSION, uptime_ms: 1, protocol: GRAPH_RPC_PROTOCOL });
    child = fake.child;
    await writeFile(join(home, 'daemon.json'), JSON.stringify({
      pid: child.pid!, host: '127.0.0.1', port: fake.port, token: 't', version: FLOWLENS_VERSION, started_at: new Date().toISOString(),
    }));
    expect(await findDaemon()).toBeNull();
    expect((await listKnownDaemons())[0]).toMatchObject({ legacy: true, own: false, alive: true });
  });
});
