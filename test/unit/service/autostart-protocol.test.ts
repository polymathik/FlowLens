/**
 * A daemon still running older code (same package version, older graph RPC
 * method set — e.g. no Phase 8 `replaceFile`) must not be reused: clients
 * would get "Unknown graph method". `findDaemon` treats a different or
 * missing `protocol` in the ping like a version mismatch and replaces it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { GRAPH_READ_METHODS, GRAPH_RPC_PROTOCOL, GRAPH_WRITE_METHODS } from '../../../src/contracts/service.js';
import { findDaemon } from '../../../src/service/autostart.js';
import { writeDaemonInfo } from '../../../src/service/daemon-info.js';
import { FLOWLENS_VERSION } from '../../../src/service/runtime.js';
import { restoreEnv, startHarness, type Harness } from '../../helpers/daemon-harness.js';
import { removeDir, tempDir } from '../../helpers/service-env.js';

/** Minimal fake daemon in a child process: answers ping with `pong`, exits on /api/shutdown. */
function fakeDaemon(pong: Record<string, unknown>): Promise<{ child: ChildProcess; port: number }> {
  const src = `
    const http = require('node:http');
    const pong = ${JSON.stringify(pong)};
    const srv = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/shutdown') { res.end('{"ok":true}'); srv.close(); setImmediate(() => process.exit(0)); return; }
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

  it('replaces a same-version daemon whose ping has no protocol (pre-Phase-8 code)', async () => {
    home = await tempDir('flowlens-home-');
    process.env.FLOWLENS_HOME = home;
    const fake = await fakeDaemon({ ok: true, version: FLOWLENS_VERSION, uptime_ms: 1 });
    child = fake.child;
    writeDaemonInfo({
      pid: child.pid!, host: '127.0.0.1', port: fake.port, token: 't', version: FLOWLENS_VERSION, started_at: new Date().toISOString(),
    });
    const exited = once(child, 'exit');
    expect(await findDaemon()).toBeNull();
    await exited;
    expect(child.exitCode).toBe(0);
  });
});
