/**
 * E2E server for the multi-project explorer. In an isolated FLOWLENS_HOME:
 * index two fixture projects (sample-app = A, notes-app = B), register
 * them plus a third that is then deleted (missing), start the daemon with
 * the explorer, hold a watch lease on A (live updates), and — with `--dev`
 * — a Vite dev host in front of it. Prints one `READY {json}` line.
 *
 *   node --import tsx test/canvas/e2e/serve.ts <workDir> [--dev]
 *
 * Without `--dev` the daemon serves the BUILT bundle (dist/canvas/app), so
 * run `npm run build:canvas` first.
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createIndexedFixture, createNotesProject } from '../helpers/fixture-project.js';
import { createDeepProject } from '../helpers/deep-fixture.js';
import { createCommunitiesProject } from '../helpers/communities-fixture.js';
import { createLayeredProject } from '../helpers/layered-fixture.js';
import { createHalcyonCopy } from '../helpers/halcyon-copy.js';
import { createHistoryProject, createSingleCommitProject } from '../helpers/history-project.js';
import { startDaemon } from '../../../src/service/daemon.js';
import { DaemonClient } from '../../../src/service/client.js';
import { RemoteGraphStore } from '../../../src/service/remote-graph-store.js';
import { startDevHost } from '../../../src/cli/canvas-host/dev-host.js';
import type { ProjectWithStatus } from '../../../src/contracts/projects.js';

const [workDir, ...flags] = process.argv.slice(2);
if (!workDir) {
  console.error('usage: serve.ts <workDir> [--dev]');
  process.exit(2);
}
process.env.FLOWLENS_HOME = join(workDir, 'home');
await mkdir(process.env.FLOWLENS_HOME, { recursive: true });

const a = await createIndexedFixture(join(workDir, 'a'));
await mkdir(join(workDir, 'b'), { recursive: true });
const b = await createNotesProject(join(workDir, 'b'));
const deep = await createDeepProject(join(workDir, 'deep'));
const comm = await createCommunitiesProject(join(workDir, 'comm'));
const layered = await createLayeredProject(join(workDir, 'layered'));
const halcyon = await createHalcyonCopy(join(workDir, 'halcyon')); // null when no Halcyon snapshot exists (scenarios skip)
const hist = await createHistoryProject(join(workDir, 'hist'));
const tiny = await createSingleCommitProject(join(workDir, 'tiny'));
const goneRoot = join(workDir, 'gone-app');
await mkdir(join(goneRoot, '.flowlens'), { recursive: true });

const daemon = await startDaemon({ port: 0, log: () => {}, options: { exitWhenIdleMs: 0 } });
const client = new DaemonClient(daemon.info);
const register = (root: string) => client.request<ProjectWithStatus>('POST', '/api/projects/resolve', { root, register: true });
const [pa, pb, pc] = [await register(a.rootDir), await register(b.rootDir), await register(goneRoot)];
await rm(goneRoot, { recursive: true, force: true });

// `flowlens canvas --watch` equivalent for project A.
const watched = new RemoteGraphStore(async () => new DaemonClient(daemon.info), 'e2e');
await watched.open(join(a.rootDir, '.flowlens', 'graph'));
await watched.watch(100, () => {});

const dev = flags.includes('--dev') ? await startDevHost({ daemonPort: daemon.info.port, port: 0 }) : null;
const base = dev ? dev.origin : `http://127.0.0.1:${daemon.info.port}`;

console.log(`READY ${JSON.stringify({
  base,
  daemon: `http://127.0.0.1:${daemon.info.port}`,
  token: daemon.info.token,
  hasGit: a.hasGit,
  mode: dev ? 'dev' : 'bundle',
  projects: { deep: { root: deep.rootDir }, comm: { root: comm.rootDir }, layered: { root: layered.rootDir }, halcyon: halcyon ? { root: halcyon.rootDir } : null, hist: { root: hist.rootDir }, tiny: { root: tiny.rootDir }, a: { id: pa.id, root: a.rootDir }, b: { id: pb.id, root: b.rootDir }, missing: { id: pc.id, root: goneRoot } },
})}`);

const shutdown = async () => {
  await watched.close().catch(() => undefined);
  await dev?.close();
  client.destroy();
  await daemon.shutdown();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
