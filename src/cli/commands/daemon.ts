/**
 * `flowlens daemon start|stop|status` — manage the local graph service.
 * Normally you never need this: every command auto-starts the daemon.
 */
import { Command } from 'commander';
import type { ProjectDetail } from '../../contracts/service.js';
import { connectDaemon, findDaemon, stopDaemon } from '../../service/autostart.js';
import { daemonInfoPath, daemonLogPath } from '../../service/daemon-info.js';
import { startDaemon } from '../../service/daemon.js';
import { printError, printSuccess, printWarning } from '../output.js';
import { renderTable } from './projects.js';

const start = new Command('start')
  .description('Start the daemon (detached unless --foreground)')
  .option('--foreground', 'Run in this process (used by auto-start)')
  .action(async (opts: { foreground?: boolean }) => {
    try {
      if (opts.foreground) {
        const existing = await findDaemon();
        if (existing) {
          process.stderr.write(`daemon already running (pid ${existing.info.pid}, port ${existing.info.port})\n`);
          existing.destroy();
          return;
        }
        const handle = await startDaemon({ onExit: () => process.exit(0) });
        const stop = () => void handle.shutdown();
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
        process.on('SIGHUP', stop);
        return;
      }
      const client = await connectDaemon();
      printSuccess(`FlowLens daemon running (pid ${client.info.pid}, 127.0.0.1:${client.info.port})`);
      client.destroy();
    } catch (err) {
      printError(`Daemon start failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

const stop = new Command('stop')
  .description('Stop the daemon (closes every project graph)')
  .action(async () => {
    const client = await findDaemon();
    if (!client) {
      printWarning('FlowLens daemon is not running');
      return;
    }
    const pid = client.info.pid;
    if (await stopDaemon(client)) printSuccess(`Stopped FlowLens daemon (pid ${pid})`);
    else {
      printError(`Daemon (pid ${pid}) did not exit in time`);
      process.exit(1);
    }
  });

const status = new Command('status')
  .description('Show whether the daemon runs and which project graphs are open')
  .option('--json', 'Machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const client = await findDaemon();
    if (!client) {
      if (opts.json) console.log(JSON.stringify({ running: false }, null, 2));
      else printWarning('FlowLens daemon is not running');
      process.exitCode = 3;
      return;
    }
    try {
      const pong = await client.ping();
      const projects = await client.request<ProjectDetail[]>('GET', '/api/projects');
      const { token: _token, ...info } = client.info;
      if (opts.json) {
        console.log(JSON.stringify({ running: true, ...info, uptime_ms: pong?.uptime_ms, projects }, null, 2));
        return;
      }
      printSuccess(`FlowLens daemon v${info.version} — pid ${info.pid}, 127.0.0.1:${info.port}, up ${Math.round((pong?.uptime_ms ?? 0) / 1000)}s`);
      console.log(`  info: ${daemonInfoPath()}\n  log:  ${daemonLogPath()}\n`);
      console.log(renderTable(['NAME', 'ID', 'STATUS', 'GRAPH', 'LEASES', 'WATCHING'], projects.map((p) => [
        p.name, p.id, p.status, p.graph.open ? 'open' : 'closed', String(p.graph.leases), p.graph.watching ? 'yes' : 'no',
      ])));
    } finally {
      client.destroy();
    }
  });

export const daemonCommand = new Command('daemon')
  .description('Manage the local FlowLens graph service')
  .addCommand(start)
  .addCommand(stop)
  .addCommand(status);
