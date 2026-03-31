import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { printHeader, printError, printSuccess } from '../output.js';

export const canvasCommand = new Command('canvas')
  .description('Open the visual dependency graph canvas in the browser')
  .option('--port <port>', 'Dev server port', '5173')
  .option('--api-port <port>', 'API server port', '3001')
  .option('--no-open', 'Don\'t auto-open browser')
  .action(async (opts) => {
    const rootDir = resolve('.');
    const flowlensDir = join(rootDir, '.flowlens');

    if (!existsSync(flowlensDir)) {
      printError('.flowlens/ not found. Run "flowlens init" first.');
      process.exit(1);
    }

    try {
      printHeader('FlowLens Canvas');

      // Start graph API server
      const { startGraphServer } = await import('../../canvas/api/graph-server.js');
      const apiServer = await startGraphServer(flowlensDir, parseInt(opts.apiPort));
      printSuccess(`Graph API server running on port ${opts.apiPort}`);

      // Start Vite dev server
      const { createServer } = await import('vite');
      const vite = await createServer({
        root: join(rootDir, 'src/canvas'),
        server: {
          port: parseInt(opts.port),
          open: opts.open !== false,
          proxy: {
            '/flowlens-api': {
              target: `http://localhost:${opts.apiPort}`,
              changeOrigin: true,
            },
          },
        },
      });
      await vite.listen();
      printSuccess(`Canvas running at http://localhost:${opts.port}`);

      // Handle shutdown
      const cleanup = () => {
        vite.close();
        apiServer.close();
        process.exit(0);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    } catch (err) {
      printError(`Canvas failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
