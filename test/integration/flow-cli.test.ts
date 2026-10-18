/**
 * `flowlens flow` through the real CLI (tsx): through the daemon (default,
 * RemoteGraphStore → includes the unresolved-relation RPC) and with
 * --no-daemon. Lists entry points, prints the tree, --in, --json, errors.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FlowTraceSchema } from '../../src/contracts/flow.js';
import { removeDir, runCli, tempDir } from '../helpers/service-env.js';
import { createFlowFixture, type FlowFixture } from '../helpers/flow-fixture.js';

let fx: FlowFixture;
let home: string;
let env: Record<string, string>;

beforeAll(async () => {
  home = await tempDir('flowlens-home-');
  env = { FLOWLENS_HOME: home, FLOWLENS_NO_DAEMON: '', FLOWLENS_DAEMON_PORT: '0', FORCE_COLOR: '0' };
  fx = await createFlowFixture();
}, 60_000);

afterAll(async () => {
  await runCli(['daemon', 'stop'], fx.rootDir, env);
  await removeDir(home);
  await fx?.cleanup();
});

const flow = (args: string[], extra: Record<string, string> = {}) => runCli(['flow', ...args], fx.rootDir, { ...env, ...extra }, 90_000);

describe('flowlens flow', () => {
  it('--list prints the entry points grouped with labels and locations (via the daemon)', async () => {
    const r = await flow(['--list']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('GET /api/users');
    expect(r.stdout).toContain('src/server.ts:8');
    expect(r.stdout).toContain('cli: db migrate');
    expect(r.stdout).not.toContain('test: users.test.ts');
    const kinds = await flow(['--list', '--kind', 'cli_command', '--json']);
    const parsed = JSON.parse(kinds.stdout) as { entry_points: Array<{ kind: string }> };
    expect(new Set(parsed.entry_points.map((e) => e.kind))).toEqual(new Set(['cli_command']));
  });

  it('prints an indented call tree for an entry label', async () => {
    const r = await flow(['GET /api/users', '--depth', '3']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^GET \/api\/users/);
    expect(r.stdout).toMatch(/listUsers\(\)\s+src\/handlers\/users\.ts:\d+/);
    expect(r.stdout).toMatch(/└─ findUsers\(\)/);
    expect(r.stdout).toMatch(/query\(\)\s+src\/db\/client\.ts/);
  });

  it('--json is the contract-valid trace; --no-daemon gives the same answer', async () => {
    const viaDaemon = await flow(['POST /api/users', '--json']);
    const direct = await flow(['POST /api/users', '--json', '--no-daemon'], { FLOWLENS_NO_DAEMON: '1' });
    expect(direct.code, direct.stderr).toBe(0);
    const a = FlowTraceSchema.parse(JSON.parse(viaDaemon.stdout));
    const b = FlowTraceSchema.parse(JSON.parse(direct.stdout));
    expect(b).toEqual(a);
    expect(a.hops.some((x) => x.resolution === 'unresolved' && x.target_name === 'auditLog')).toBe(true);
  });

  it('--in shows the triggers of a function', async () => {
    const r = await flow(['src/db/client.ts/query', '--in']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('GET /api/users');
    expect(r.stdout.toLowerCase()).toContain('trigger');
  });

  it('exits non-zero with a helpful message for unknown, ambiguous and invalid input', async () => {
    const nf = await flow(['GET /api/userz']);
    expect(nf.code).toBe(1);
    expect(nf.stderr + nf.stdout).toContain('GET /api/users');
    const amb = await flow(['step']);
    expect(amb.code).toBe(1);
    expect(amb.stderr).toMatch(/ambiguous|matches/i);
    const bad = await flow(['x', '--depth', '9']);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('--depth');
    const none = await flow([]);
    expect(none.code).toBe(2);
  });
});
