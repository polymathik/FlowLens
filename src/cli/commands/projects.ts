/**
 * `flowlens projects list|remove|rename` — manage the project registry
 * (`$FLOWLENS_HOME/projects.json`). Projects register themselves on
 * `init`/`index`/`serve`; removing only unregisters (the project's
 * `.flowlens/` is left untouched).
 */
import { Command } from 'commander';
import type { ProjectWithStatus } from '../../contracts/projects.js';
import { syncLastIndexed } from '../../projects/manifest-sync.js';
import { FileProjectRegistry } from '../../projects/registry.js';
import { evictFromDaemon } from '../../service/project-setup.js';
import { printError, printSuccess } from '../output.js';

/** Plain fixed-width table for CLI listings (shared with `daemon status`). */
export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [line(headers), ...rows.map(line)].join('\n');
}

async function resolveOrExit(reg: FileProjectRegistry, ref: string): Promise<ProjectWithStatus> {
  const p = await reg.lookup(ref);
  if (!p) {
    printError(`No registered project matches "${ref}" (id, name or path)`);
    process.exit(1);
  }
  return p;
}

const list = new Command('list')
  .alias('ls')
  .description('List registered projects')
  .option('--json', 'Machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const reg = new FileProjectRegistry();
    const projects = await reg.list();
    for (const p of projects) if (p.status === 'ok') p.last_indexed = await syncLastIndexed(reg, p);
    if (opts.json) {
      console.log(JSON.stringify(projects, null, 2));
      return;
    }
    if (projects.length === 0) {
      console.log('No projects registered yet. Run "flowlens init" in a project.');
      return;
    }
    console.log(renderTable(['NAME', 'ID', 'STATUS', 'LAST INDEXED', 'ROOT'], projects.map((p) => [
      p.name, p.id, p.status, p.last_indexed ?? '-', p.root,
    ])));
  });

const remove = new Command('remove')
  .alias('rm')
  .description('Unregister a project (by id, name or path); its .flowlens/ is kept')
  .argument('<project>', 'project id, name or root path')
  .action(async (ref: string) => {
    const reg = new FileProjectRegistry();
    const p = await resolveOrExit(reg, ref);
    await evictFromDaemon(p.root).catch(() => undefined);
    await reg.remove(p.id);
    printSuccess(`Removed ${p.name} (${p.id}) from the registry`);
  });

const rename = new Command('rename')
  .description('Change a project\'s display name')
  .argument('<project>', 'project id, name or root path')
  .argument('<name>', 'new unique display name')
  .action(async (ref: string, name: string) => {
    const reg = new FileProjectRegistry();
    const p = await resolveOrExit(reg, ref);
    try {
      const rec = await reg.rename(p.id, name);
      printSuccess(`Renamed ${p.name} → ${rec.name}`);
    } catch (err) {
      printError((err as Error).message);
      process.exit(1);
    }
  });

export const projectsCommand = new Command('projects')
  .description('Manage the registry of FlowLens projects')
  .addCommand(list)
  .addCommand(remove)
  .addCommand(rename);
