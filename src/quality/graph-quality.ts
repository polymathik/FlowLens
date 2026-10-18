/**
 * Graph quality measurement (Phase 8).
 *
 * Reads the stored graph (and, when available, the persisted symbol
 * records) and reports how trustworthy it is: dangling edges, unresolved /
 * ambiguous references by relation type and language, id collisions,
 * duplicate declarations and the import-resolution rate.
 */
import type { GraphStore } from '../contracts/graph.js';
import type { GraphQuality, ResolutionCounts } from '../contracts/quality.js';
import type { RelationType } from '../contracts/relations.js';
import type { FileSymbolRecord } from '../contracts/symbols.js';

export interface QualityExtras {
  /** Persisted symbol records (all indexed files). */
  records?: Map<string, FileSymbolRecord>;
  /** Cross-file id collisions detected during the last run. */
  idCollisions?: number;
}

export async function computeGraphQuality(store: GraphStore, extras: QualityExtras = {}): Promise<GraphQuality> {
  const nodes = await store.getAllNodes();
  const edges = await store.getAllEdges();
  const unresolved = (await store.getUnresolvedRelations?.()) ?? [];
  const ids = new Set(nodes.map((n) => n.id));
  const languageOfFile = new Map<string, string>();
  for (const n of nodes) if (n.kind === 'file') languageOfFile.set(n.file, n.language);

  const resolution: Partial<Record<RelationType, ResolutionCounts>> = {};
  const bump = (type: RelationType, key: keyof ResolutionCounts) => {
    const c = resolution[type] ?? (resolution[type] = { resolved: 0, unresolved: 0, ambiguous: 0 });
    c[key]++;
  };

  let dangling = 0;
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) dangling++;
    if (e.resolution === 'resolved') bump(e.type, 'resolved');
  }

  const byType: Partial<Record<RelationType, number>> = {};
  const byLanguage: Record<string, number> = {};
  let ambiguous = 0;
  let memberLeaves = 0;
  for (const r of unresolved) {
    if (r.type === 'call' && r.meta?.receiver !== undefined) { memberLeaves++; continue; }
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    const lang = languageOfFile.get(r.location.file) ?? 'unknown';
    byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
    if (r.resolution === 'ambiguous') { ambiguous++; bump(r.type, 'ambiguous'); } else bump(r.type, 'unresolved');
  }

  const recordStats = statsFromRecords(extras.records);
  return {
    entity_count: nodes.length,
    edge_count: edges.length,
    dangling_edges: dangling,
    dangling_ratio: edges.length === 0 ? 0 : dangling / edges.length,
    unresolved_count: unresolved.length - ambiguous - memberLeaves,
    member_unresolved_count: memberLeaves,
    ambiguous_count: ambiguous,
    unresolved_by_type: byType,
    unresolved_by_language: byLanguage,
    resolution_by_type: resolution,
    id_collisions: extras.idCollisions ?? 0,
    ...recordStats,
  };
}

function statsFromRecords(records?: Map<string, FileSymbolRecord>) {
  let duplicates = 0;
  let syntaxFiles = 0;
  const seen = new Set<string>();
  let resolved = 0;
  for (const [file, rec] of records ?? []) {
    duplicates += rec.duplicates ?? 0;
    if ((rec.syntax_errors ?? 0) > 0) syntaxFiles++;
    const refs = [
      ...rec.symbols.imports.map((b) => ({ spec: b.specifier, ext: b.external, pkg: b.source_package, src: b.source_file })),
      ...rec.symbols.reexports.map((r) => ({ spec: r.specifier, ext: false, pkg: undefined, src: r.source_file })),
    ];
    for (const ref of refs) {
      if (ref.ext || ref.pkg !== undefined) continue;
      const key = `${file}\u0000${ref.spec}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (ref.src) resolved++;
    }
  }
  return {
    duplicate_declarations: duplicates,
    relative_imports: seen.size,
    relative_imports_resolved: resolved,
    import_resolution_rate: seen.size === 0 ? 1 : resolved / seen.size,
    files_with_syntax_errors: syntaxFiles,
  };
}

/** Short human-readable summary printed after `flowlens init` / `index`. */
export function formatQualitySummary(q: GraphQuality): string[] {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `Graph quality: ${q.entity_count} entities, ${q.edge_count} edges`,
    `  imports resolved:   ${q.relative_imports_resolved}/${q.relative_imports} (${pct(q.import_resolution_rate)})`,
    `  dangling edges:     ${q.dangling_edges} (${pct(q.dangling_ratio)})`,
    `  unresolved refs:    ${q.unresolved_count}${q.ambiguous_count ? ` (+${q.ambiguous_count} ambiguous)` : ''}`,
  ];
  if (q.member_unresolved_count) lines.push(`  unresolved members:  ${q.member_unresolved_count} (recv.method() calls not found on a project receiver)`);
  const top = Object.entries(q.unresolved_by_type).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 4);
  if (top.length > 0) lines.push(`    by type: ${top.map(([t, n]) => `${t} ${n}`).join(', ')}`);
  if (q.id_collisions > 0) lines.push(`  id collisions:      ${q.id_collisions}`);
  if (q.duplicate_declarations > 0) lines.push(`  merged duplicates:  ${q.duplicate_declarations} (overloads/redefinitions)`);
  if (q.files_with_syntax_errors > 0) lines.push(`  syntax errors in:   ${q.files_with_syntax_errors} file(s)`);
  return lines;
}
