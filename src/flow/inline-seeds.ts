/**
 * Calls made from code the graph cannot attribute: module-scope statements and
 * inline callbacks at module scope (`program.command('x').action(() => run())`,
 * `app.get('/x', (req, res) => list())`, a script's top-level `main()`).
 *
 * The extractor gives these calls no owner entity, so they are absent from the
 * graph. For a flow rooted in such code we read the source: blank everything
 * that belongs to a named entity (those calls ARE in the graph), keep only the
 * requested lines, and resolve each `name(` / `new Name(` through this file's
 * declarations and imports. Member calls (`obj.method()`) are not resolved —
 * without types their target is unknown — so this finds the direct calls only.
 * Every such hop is marked `provenance: 'source_scan'` with reduced confidence.
 */
import type { Entity } from '../contracts/entities.js';
import type { FlowGraph } from './graph.js';
import { resolveName } from './resolve-name.js';
import { lineAt, lineStartsOf } from './source.js';

export interface SeedCall {
  name: string;
  line: number;
  isNew: boolean;
  matches: Entity[];
}

const CALL = /(?<![\w$.])(new\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>)?\s*\(/g;
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'void', 'await', 'delete', 'import', 'super', 'require', 'async', 'def', 'fn', 'func', 'with', 'elif', 'except', 'print',
]);
const SCOPES = new Set(['function', 'method', 'class', 'component', 'interface']);

/** Text with every line outside [from, to] and every named-entity body blanked (offsets preserved). */
function visibleText(graph: FlowGraph, file: string, text: string, from: number, to: number): string {
  const starts = lineStartsOf(text);
  const blank = new Array<boolean>(starts.length + 1).fill(false);
  for (let l = 1; l <= starts.length; l++) if (l < from || l > to) blank[l] = true;
  for (const e of graph.byFile.get(file) ?? []) {
    if (!SCOPES.has(e.kind) || e.location.line_end - e.location.line_start >= starts.length - 1) continue; // components span the whole .svelte file
    for (let l = e.location.line_start; l <= e.location.line_end; l++) blank[l] = true;
  }
  let out = '';
  for (let l = 1; l <= starts.length; l++) {
    const seg = text.slice(starts[l - 1], starts[l] ?? text.length);
    out += blank[l] ? seg.replace(/[^\n]/g, ' ') : seg;
  }
  return out;
}

/** Direct calls found in `file` lines [from, to] that are not inside any named entity. */
export function scanSeedCalls(graph: FlowGraph, file: string, text: string, from = 1, to = Number.MAX_SAFE_INTEGER): SeedCall[] {
  const visible = visibleText(graph, file, text, from, to);
  const starts = lineStartsOf(text);
  const out: SeedCall[] = [];
  for (const m of visible.matchAll(CALL)) {
    const name = m[2];
    if (KEYWORDS.has(name)) continue;
    const before = visible.slice(Math.max(0, (m.index as number) - 9), m.index as number);
    if (/function\s+$/.test(before) || /\bclass\s+$/.test(before)) continue; // a declaration, not a call
    const line = lineAt(starts, m.index as number);
    const matches = resolveName(graph, { file, name, line, kinds: new Set(m[1] ? ['class', 'component'] : ['function', 'class', 'component']) }).map((x) => x.entity);
    if (matches.length > 0) out.push({ name, line, isNew: !!m[1], matches });
  }
  return out;
}
