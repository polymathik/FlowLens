/**
 * Entry-point detection: runs every detector over the graph (plus the text of
 * the few files that register routes/commands), merges, de-duplicates and
 * orders the result deterministically.
 *
 * ```mermaid
 * flowchart LR
 *   G[FlowGraph] --> D1[http routes] & D2[decorators] & D3[file routes] & D4[cli commands]
 *   G --> D5[package.json] & D6[main fns] & D7[ui roots + events] & D8[tests]
 *   S[SourceProvider] -.-> D1 & D2 & D4 & D5 & D6 & D7
 *   D1 & D2 & D3 & D4 & D5 & D6 & D7 & D8 --> M[merge + dedupe + order]
 * ```
 */
import type { EntryPoint, EntryPointKind } from '../../contracts/flow.js';
import { DEFAULT_ENTRY_KINDS, ENTRY_POINT_KINDS } from '../../contracts/flow.js';
import type { FlowGraph } from '../graph.js';
import type { SourceProvider } from '../source.js';
import { detectCliCommands } from './cli.js';
import { detectDecoratorEntries } from './decorators.js';
import { detectUiAndEvents } from './events-ui.js';
import { detectFileRoutes } from './file-routes.js';
import { detectHttpRoutes } from './http-routes.js';
import { detectMainFunctions } from './main-fns.js';
import { detectPackageEntries } from './package-entries.js';
import { detectTestEntries } from './tests.js';
import { DetectContext, type Detector } from './types.js';

const DETECTORS: Array<[string, Detector]> = [
  ['http-routes', detectHttpRoutes],
  ['decorators', detectDecoratorEntries],
  ['file-routes', detectFileRoutes],
  ['cli', detectCliCommands],
  ['package', detectPackageEntries],
  ['main', detectMainFunctions],
  ['ui-events', detectUiAndEvents],
  ['tests', detectTestEntries],
];

const KIND_RANK = new Map<EntryPointKind, number>(
  (['http_route', 'cli_command', 'bin', 'main', 'page_route', 'ui_component_root', 'event_handler', 'export_api', 'test', 'unknown'] as const).map((k, i) => [k, i]),
);

export const compareEntries = (a: EntryPoint, b: EntryPoint): number =>
  (KIND_RANK.get(a.kind) ?? 99) - (KIND_RANK.get(b.kind) ?? 99)
  || a.file.localeCompare(b.file) || a.line - b.line || a.label.localeCompare(b.label) || a.entity_id.localeCompare(b.entity_id);

const keyOf = (e: EntryPoint): string => `${e.kind}|${e.entity_id}|${e.label}|${e.span?.line_start ?? ''}`;

export interface DetectOptions {
  /** A detector that throws is skipped (and reported here) rather than failing the whole listing. */
  onError?: (detector: string, err: unknown) => void;
}

export function detectEntryPoints(graph: FlowGraph, source: SourceProvider, opts: DetectOptions = {}): EntryPoint[] {
  const ctx = new DetectContext(graph, source);
  const merged = new Map<string, EntryPoint>();
  for (const [name, detect] of DETECTORS) {
    let found: EntryPoint[] = [];
    try {
      found = detect(ctx);
    } catch (err) {
      opts.onError?.(name, err);
    }
    for (const e of found) {
      const hit = merged.get(keyOf(e));
      if (!hit || e.confidence > hit.confidence) merged.set(keyOf(e), e);
    }
  }
  const all = [...merged.values()];
  // A bin/script file already stands for its `main()`: do not list the function separately.
  const covered = new Set(all.filter((e) => e.kind === 'bin' || e.label.startsWith('script:')).map((e) => graph.byId.get(e.entity_id)?.file));
  return all.filter((e) => !(e.label.startsWith('main:') && covered.has(graph.byId.get(e.entity_id)?.file))).sort(compareEntries);
}

export interface EntryFilter {
  kinds?: readonly EntryPointKind[];
  /** Repo-relative path prefix on the declaring file. */
  path?: string;
  includeTests?: boolean;
  /** Entries below this confidence are dropped. */
  minConfidence?: number;
}

export function filterEntryPoints(entries: EntryPoint[], f: EntryFilter = {}): EntryPoint[] {
  const kinds = new Set<EntryPointKind>(f.kinds ?? (f.includeTests ? [...DEFAULT_ENTRY_KINDS, 'test'] : DEFAULT_ENTRY_KINDS));
  const prefix = f.path?.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return entries.filter((e) =>
    kinds.has(e.kind)
    && (!prefix || e.file === prefix || e.file.startsWith(`${prefix}/`))
    && (f.minConfidence === undefined || e.confidence >= f.minConfidence));
}

export function countByKind(entries: EntryPoint[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of ENTRY_POINT_KINDS) {
    const n = entries.filter((e) => e.kind === k).length;
    if (n > 0) out[k] = n;
  }
  return out;
}

export { DetectContext } from './types.js';
