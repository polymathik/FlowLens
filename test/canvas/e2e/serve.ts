/**
 * E2E server: index the sample-app fixture, start the graph API and a Vite
 * dev server for `src/canvas` (inline config, independent of the CLI), then
 * print one `READY {json}` line. Run via `node --import tsx`.
 *
 *   node --import tsx test/canvas/e2e/serve.ts <workDir> <apiPort> <uiPort>
 */
import { resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createIndexedFixture } from '../helpers/fixture-project.js';
import { startGraphServer } from '../../../src/canvas/api/graph-server.js';

const [workDir, apiPortArg = '3391', uiPortArg = '5391'] = process.argv.slice(2);
if (!workDir) {
  console.error('usage: serve.ts <workDir> [apiPort] [uiPort]');
  process.exit(2);
}

const fixture = await createIndexedFixture(workDir);
const api = await startGraphServer(fixture.flowlensDir, Number(apiPortArg));
const vite = await createServer({
  configFile: false,
  root: resolve(import.meta.dirname, '../../../src/canvas'),
  plugins: [react()],
  logLevel: 'warn',
  server: {
    port: Number(uiPortArg),
    strictPort: true,
    host: '127.0.0.1',
    proxy: { '/flowlens-api': { target: `http://127.0.0.1:${api.port}`, changeOrigin: true } },
  },
});
await vite.listen();

console.log(
  `READY ${JSON.stringify({ base: `http://127.0.0.1:${uiPortArg}`, api: `http://127.0.0.1:${api.port}`, hasGit: fixture.hasGit, rootDir: fixture.rootDir })}`,
);

const shutdown = async () => {
  await vite.close();
  api.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
