/**
 * Interface diff + module signatures on REAL extracted data (Phase 8):
 * parameter qualified names `fn.param` drive parameter_added/removed,
 * removed entities count dependents on the snapshot, and signatures list
 * only a function's own parameters in order.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexFixture, type IndexedFixture } from './harness.js';
import { computeDiff } from '../../src/analysis/diff-computer.js';
import { handleGetModuleInterface } from '../../src/mcp/tools/get-module-interface.js';
import type { SnapshotData } from '../../src/contracts/analysis/snapshots.js';
import type { ServerDependencies } from '../../src/mcp/server.js';

let fx: IndexedFixture | null = null;
afterEach(async () => { await fx?.cleanup(); fx = null; });

const LIB_V1 = `export function format(value: string, width: number): string { return value; }
export function pad(text: string, size: number): string {
  const inner = (n: number) => n;
  return text + inner(size);
}
export function gone(a: number): number { return a; }
`;
const USER = `import { format, gone } from './lib.js';
export function show(): string { gone(1); return format('x', 2); }
export function again(): number { return gone(2); }
`;

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fl-diff-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/lib.ts'), LIB_V1);
  writeFileSync(join(dir, 'src/user.ts'), USER);
  return dir;
}

describe('interface diff on extracted data', () => {
  it('detects parameter changes and counts removed-entity dependents on the snapshot', async () => {
    fx = await indexFixture(project());
    const snapshot: SnapshotData = { sha: 'v1', timestamp: '', entities: fx.nodes, relations: fx.edges };
    writeFileSync(join(fx.root, 'src/lib.ts'),
      `export function format(value: string, width: number, fill: string): string { return value; }
export function pad(text: string): string { return text; }
`);
    await fx.reindex();
    const diff = await computeDiff(fx.store, snapshot);
    const summary = diff.changes.map((c) => `${c.change_type} ${c.entity_name} ${c.details}`);
    expect(summary).toContain("parameter_added format Parameter 'fill' added to format");
    expect(summary).toContain("parameter_removed pad Parameter 'size' removed from pad");
    // the nested arrow's parameter `n` is not pad's parameter
    expect(summary.filter((s) => s.includes("'n'"))).toEqual([]);
    // parameters are not double-reported as removed entities
    expect(diff.changes.filter((c) => c.before?.kind === 'parameter' || c.after?.kind === 'parameter')).toEqual([]);
    const removed = diff.changes.find((c) => c.change_type === 'removed' && c.entity_name === 'gone');
    expect(removed?.affected_dependents).toBe(2); // show + again called it
  });

  it('builds signatures from the own parameters of each function, in order', async () => {
    fx = await indexFixture(project());
    const deps = {
      graph: fx.store,
      fileIndexPath: join(fx.root, '.flowlens/file_index.json'),
      flowlensDir: join(fx.root, '.flowlens'),
      rootDir: fx.root,
    } as unknown as ServerDependencies;
    const res = await handleGetModuleInterface({ module: 'src/lib.ts' }, deps);
    const data = JSON.parse(res.content[0].text).data;
    const sig = Object.fromEntries(data.exports.map((e: { entity: { name: string }; type_signature?: string }) => [e.entity.name, e.type_signature]));
    expect(sig.format).toBe('(value, width)');
    expect(sig.pad).toBe('(text, size)');
    expect(sig.gone).toBe('(a)');
  });
});
