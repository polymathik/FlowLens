/**
 * Dependency edges of one exported tree, using the indexer's own pipeline
 * (discovery → parse → project symbol table → pass 2) but no graph store,
 * no manifest and no `.flowlens` writes: the result is file-to-file only.
 */
import { clearModuleResolverCaches } from '../parser/resolution/ts-module-resolver.js';
import type { RelationType } from '../contracts/relations.js';
import type { FileSymbolRecord } from '../contracts/symbols.js';
import { discoverFiles } from '../discovery/file-walker.js';
import { recordFromParsed } from '../indexer/symbol-snapshot.js';
import { parallelParse, type ParsedFileOutput } from '../indexer/parallel-parser.js';
import { runPass2 } from '../indexer/pass2.js';
import type { Deadline } from './deadline.js';
import type { HistoryFileFilter } from './file-filter.js';

/** Relation types that make one file depend on another. */
export const EDGE_TYPES: ReadonlySet<RelationType> = new Set<RelationType>(['import', 'call', 'extend', 'implement']);
/** Files per parse call; the deadline is checked between batches. */
const BATCH = 100;

export interface SampleGraph {
  files: string[];
  /** Directed `[from, to, weight]` file paths, `from !== to`, sorted. */
  edges: Array<[string, string, number]>;
}

export async function sampleGraph(dir: string, filter: HistoryFileFilter, deadline: Deadline): Promise<SampleGraph> {
  clearModuleResolverCaches();
  const discovered = await discoverFiles({ rootDir: dir, excludePatterns: filter.patterns, supportedExtensions: filter.extensions });
  const parsed: ParsedFileOutput[] = [];
  for (let i = 0; i < discovered.length; i += BATCH) {
    deadline.check();
    // Always on this thread: `parseChunk` awaits a file read per file, so the daemon's event loop keeps turning,
    // and parse *worker threads* crash the process (SIGSEGV on worker exit) once a .svelte file was parsed in them.
    const out = await parallelParse(discovered.slice(i, i + BATCH), dir, { serial: true });
    for (const p of out.parsed) if (!p.failed) parsed.push(p);
  }
  deadline.check();

  const records = new Map<string, FileSymbolRecord>();
  const fileOfEntity = new Map<string, string>();
  for (const p of parsed) {
    records.set(p.path, recordFromParsed(p));
    for (const e of p.entities) fileOfEntity.set(e.id, p.path);
  }
  const pass2 = runPass2(records, parsed);
  const weights = new Map<string, number>();
  for (const [from, { edges }] of pass2.byFile) {
    for (const r of edges) {
      if (!EDGE_TYPES.has(r.type)) continue;
      const to = fileOfEntity.get(r.to);
      if (!to || to === from) continue;
      const key = `${from}\0${to}`;
      weights.set(key, (weights.get(key) ?? 0) + Math.max(1, r.weight));
    }
  }
  const edges = [...weights].map(([k, w]): [string, string, number] => {
    const [a, b] = k.split('\0');
    return [a, b, w];
  }).sort((x, y) => x[0].localeCompare(y[0]) || x[1].localeCompare(y[1]));
  return { files: parsed.map((p) => p.path).sort(), edges };
}
