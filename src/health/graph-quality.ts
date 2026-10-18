/**
 * Graph-quality signals used for caveats and the unresolved-imports
 * finding: how many relations/imports point at nothing, and what the
 * manifest says about the last index run. Tolerates a missing manifest.
 */
import type { HealthConfidence } from '../contracts/health.js';
import type { HealthContext } from './context.js';
import { plural } from './glossary.js';

export interface GraphQuality {
  totalRelations: number;
  danglingRelations: number;
  danglingRatio: number;
  totalImports: number;
  danglingImports: number;
  unresolvedImportRatio: number;
  /** file → unresolved import count, sorted desc. */
  unresolvedByFile: Array<{ file: string; count: number; lines: number[] }>;
  /** Source-code files (not json/yaml/css/html/markdown). */
  codeFiles: number;
  /** Share of code files with at least one link to another file. */
  connectedShare: number;
  /** Manifest-reported unresolved relations / relation count (null without manifest). */
  manifestUnresolvedRatio: number | null;
}

/** Languages whose files are data/markup, not code with imports. */
export const NON_CODE_LANGUAGES = new Set(['json', 'yaml', 'css', 'html', 'markdown', 'toml', 'unknown']);
/** Languages with full support (Phase 8 honest scope). */
export const FULL_SUPPORT_LANGUAGES = new Set(['typescript', 'javascript', 'tsx', 'jsx']);

function fileLanguage(ctx: HealthContext, file: string): string {
  const ents = ctx.entitiesByFile.get(file) ?? [];
  return (ents.find((e) => e.kind === 'file') ?? ents[0])?.language ?? 'unknown';
}

export function measureGraphQuality(ctx: HealthContext): GraphQuality {
  const rels = ctx.input.relations;
  const imports = rels.filter((r) => r.type === 'import');
  const danglingImports = ctx.danglingRelations.filter((r) => r.type === 'import');
  const byFile = new Map<string, number[]>();
  for (const r of danglingImports) {
    const file = ctx.entityById.get(r.from)?.file ?? r.location.file;
    (byFile.get(file) ?? byFile.set(file, []).get(file)!).push(r.location.line);
  }
  const code = ctx.files.filter((f) => !NON_CODE_LANGUAGES.has(fileLanguage(ctx, f)));
  const connected = code.filter((f) => (ctx.fileDeps.get(f)?.size ?? 0) + (ctx.fileDependents.get(f)?.size ?? 0) > 0);
  const m = ctx.input.manifest;
  return {
    codeFiles: code.length,
    connectedShare: code.length === 0 ? 1 : connected.length / code.length,
    manifestUnresolvedRatio: m && m.relation_count > 0 ? m.errors.unresolved_relations / m.relation_count : null,
    totalRelations: rels.length,
    danglingRelations: ctx.danglingRelations.length,
    danglingRatio: rels.length === 0 ? 0 : ctx.danglingRelations.length / rels.length,
    totalImports: imports.length,
    danglingImports: danglingImports.length,
    unresolvedImportRatio: imports.length === 0 ? 0 : danglingImports.length / imports.length,
    unresolvedByFile: [...byFile.entries()]
      .map(([file, lines]) => ({ file, count: lines.length, lines: lines.sort((a, b) => a - b) }))
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)),
  };
}

/** True when the import graph is good enough to trust "nothing uses this" claims. */
export function importsTrustworthy(ctx: HealthContext, q: GraphQuality): boolean {
  return (
    q.totalImports > 0 &&
    q.unresolvedImportRatio <= ctx.thresholds.graph.unresolved_import_warn_ratio &&
    !looksDisconnected(ctx, q)
  );
}

/** Most code files have no links at all: imports were probably not understood. */
export function looksDisconnected(ctx: HealthContext, q: GraphQuality): boolean {
  const g = ctx.thresholds.graph;
  return q.codeFiles >= g.disconnected_min_files && q.connectedShare < g.disconnected_share;
}

const pct = (r: number): string => `${Math.round(r * 100)}%`;

/** Plain-English caveats about how much to trust this report. */
export function buildCaveats(ctx: HealthContext, q: GraphQuality): string[] {
  const out: string[] = [];
  const m = ctx.input.manifest;
  const g = ctx.thresholds.graph;
  if (!m) {
    out.push('No index manifest was found, so FlowLens cannot confirm the map finished building or matches your latest code. Re-run "flowlens index" to refresh it.');
  } else {
    if (m.completion !== 'complete') {
      out.push(`The last index run is marked "${m.completion}", so some of the map may be missing. Re-run "flowlens index".`);
    }
    if (m.errors.parse_failures > 0) {
      const sample = m.errors.failed_files.slice(0, 3).join(', ');
      out.push(`Map is partial: ${plural(m.errors.parse_failures, 'file')} could not be read${sample ? ` (for example ${sample})` : ''}; problems inside them are not shown.`);
    }
  }
  if (isStale(ctx)) {
    out.push('Your code changed since the map was last built, so some findings may be out of date. Re-run "flowlens index".');
  }
  if (!ctx.hasGit) {
    out.push('No git history was found, so "change risk" (code that changes often) could not be measured and is left out of the score.');
  }
  if (!ctx.input.architecture || ctx.input.architecture.layers.length === 0) {
    out.push('No architecture rules are defined (.flowlens/architecture.json), so boundary checks were skipped. Run "flowlens init" or use the canvas rule editor to add them.');
  }
  if (q.totalImports > 0 && q.unresolvedImportRatio > g.unresolved_import_warn_ratio) {
    out.push(`${pct(q.unresolvedImportRatio)} of imports could not be connected to a file, so tangles and "who relies on what" may be undercounted.`);
  } else if (q.manifestUnresolvedRatio !== null && q.manifestUnresolvedRatio > g.dangling_relation_warn_ratio) {
    out.push(`The indexer could not connect ${pct(q.manifestUnresolvedRatio)} of links between pieces of code, so some dependencies may be missing from this report.`);
  } else if (q.danglingRatio > g.dangling_relation_warn_ratio) {
    out.push(`${pct(q.danglingRatio)} of links between pieces of code could not be connected, so some dependencies may be missing from this report.`);
  }
  if (looksDisconnected(ctx, q)) {
    out.push(
      `Only ${pct(q.connectedShare)} of code files are linked to any other file in the map. Imports were probably not understood ` +
        '(for example ".js" endings on TypeScript imports or path aliases), so tangles, hubs and "unused" files are likely undercounted.',
    );
  }
  const langs = new Set(ctx.files.map((f) => fileLanguage(ctx, f)));
  const partial = [...langs].filter((l) => !FULL_SUPPORT_LANGUAGES.has(l) && !NON_CODE_LANGUAGES.has(l));
  if (partial.length > 0) {
    out.push(`Support for ${partial.sort().join(', ')} is partial: some links and complexity scores may be missing for those files.`);
  }
  out.push('These findings come from reading the code, not running it. They show what looks risky, not proven bugs.');
  return out;
}

/** low: map incomplete/disconnected/many unresolved imports; medium: no manifest, stale, or no git. */
export function confidenceFor(ctx: HealthContext, q: GraphQuality): HealthConfidence {
  const m = ctx.input.manifest;
  const g = ctx.thresholds.graph;
  if (
    looksDisconnected(ctx, q) ||
    (m && m.completion !== 'complete') ||
    (q.totalImports > 0 && q.unresolvedImportRatio > g.unresolved_import_warn_ratio)
  ) {
    return 'low';
  }
  if (!m || isStale(ctx) || !ctx.hasGit) return 'medium';
  return 'high';
}

export function isStale(ctx: HealthContext): boolean {
  const m = ctx.input.manifest;
  if (!m) return false;
  const head = ctx.input.current_git_head;
  return Boolean(head && m.git_head && head !== m.git_head);
}
