/**
 * `flowlens daemon start|stop|status` — manage the local graph service.
 * Normally you never need this: every command auto-starts the daemon.
 * Each FlowLens version runs its own daemon (Phase 12 review H2); `status`
 * lists all of them, `stop` stops this version's, `stop --all` also stops
 * other versions' daemons that no client is using.
 */
import { Command } from 'commander';
import { connectDaemon, findDaemon } from '../../service/autostart.js';
import { listKnownDaemons, stopKnownDaemons, type KnownDaemon } from '../../service/known-daemons.js';
import { flowlensHome } from '../../projects/paths.js';
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
  .description('Stop this version\'s daemon (closes every project graph)')
  .option('--all', 'Also stop other FlowLens versions\' daemons that have no live clients')
  .option('--force', 'With --all: stop them even while clients use them')
  .action(async (opts: { all?: boolean; force?: boolean }) => {
    const outcomes = await stopKnownDaemons({ all: Boolean(opts.all), force: Boolean(opts.force) });
    let failed = false;
    for (const { daemon: d, result } of outcomes) {
      const label = `${d.own ? 'FlowLens daemon' : `FlowLens daemon v${d.info.version}${d.legacy ? ' (legacy)' : ''}`} (pid ${d.info.pid})`;
      if (result === 'stopped') printSuccess(`Stopped ${label}`);
      else if (result === 'removed_stale') printWarning(`Removed stale info file of ${label}: ${d.path}`);
      else if (result === 'skipped_in_use') printWarning(`Left ${label} running: in use by ${d.leases ?? '?'} client(s). Add --force to stop it anyway.`);
      else {
        failed = true;
        printError(`${label} did not exit in time`);
      }
    }
    if (!outcomes.some((o) => o.daemon.own && o.result === 'stopped')) printWarning('This version\'s FlowLens daemon is not running');
    if (!opts.all) {
      const others = (await listKnownDaemons()).filter((d) => !d.own && d.alive);
      if (others.length > 0) console.log(`  ${others.length} daemon(s) of other FlowLens versions still running — "flowlens daemon stop --all" stops idle ones.`);
    }
    if (failed) process.exit(1);
  });

function describeDaemon(d: KnownDaemon): string {
  const tag = d.own ? 'this version' : d.legacy ? 'legacy daemon.json' : 'other version';
  const state = d.alive ? `up ${Math.round((d.pong?.uptime_ms ?? 0) / 1000)}s, ${d.leases ?? '?'} lease(s)` : 'not answering';
  return `v${d.info.version} [${tag}] — pid ${d.info.pid}, 127.0.0.1:${d.info.port}, ${state}`;
}

const status = new Command('status')
  .description('Show every FlowLens daemon (this and other versions) and which project graphs are open')
  .option('--json', 'Machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const known = await listKnownDaemons();
    const own = known.find((d) => d.own && d.alive && d.compatible);
    if (opts.json) {
      const strip = (d: KnownDaemon) => {
        const { token: _token, ...info } = d.info;
        return { ...info, own: d.own, legacy: d.legacy, alive: d.alive, leases: d.leases, info_path: d.path, uptime_ms: d.pong?.uptime_ms };
      };
      const ownInfo = own ? strip(own) : null;
      console.log(JSON.stringify({
        running: Boolean(own), ...(ownInfo ?? {}), projects: own?.projects ?? undefined, daemons: known.map(strip),
      }, null, 2));
      if (!own) process.exitCode = 3;
      return;
    }
    if (!own) {
      printWarning('This version\'s FlowLens daemon is not running');
      process.exitCode = 3;
    } else {
      printSuccess(`FlowLens daemon ${describeDaemon(own)}`);
      console.log(`  info: ${daemonInfoPath()}\n  log:  ${daemonLogPath()}\n`);
      console.log(renderTable(['NAME', 'ID', 'STATUS', 'GRAPH', 'LEASES', 'WATCHING'], (own.projects ?? []).map((p) => [
        p.name, p.id, p.status, p.graph.open ? 'open' : 'closed', String(p.graph.leases), p.graph.watching ? 'yes' : 'no',
      ])));
    }
    const others = known.filter((d) => d !== own);
    if (others.length > 0) {
      console.log(`\nOther FlowLens daemons in ${flowlensHome()}:`);
      for (const d of others) console.log(`  ${describeDaemon(d)}\n    ${d.path}`);
    }
  });

export const daemonCommand = new Command('daemon')
  .description('Manage the local FlowLens graph service')
  .addCommand(start)
  .addCommand(stop)
  .addCommand(status);
