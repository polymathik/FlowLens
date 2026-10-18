/**
 * Read-side queries behind the canvas API that need more than one graph
 * call: the project summary and the hotspot list. Pure over a GraphStore so
 * they are unit-testable without HTTP.
 */
import { join } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import type { GraphStore } from '../../contracts/graph.js';
import type { GraphManifest } from '../../contracts/manifest.js';
import type { ArchitectureConfig } from '../../contracts/architecture.js';
import type { CanvasHotspot, CanvasHotspotsResponse, CanvasSummary } from '../../contracts/canvas/index.js';
import { detectCycles } from '../../analysis/cycle-detector.js';
import { validateArchitecture } from '../../analysis/architecture-validator.js';
import { loadArchConfigOrNull } from '../../analysis/arch-config.js';

/** Saved rules, or null when there is no (valid) architecture.json. */
export const loadSavedArchitecture = (flowlensDir: string): Promise<ArchitectureConfig | null> =>
  loadArchConfigOrNull(flowlensDir);

/** Last completed index time: manifest `finished_at`, else graph dir mtime. */
export async function lastIndexed(flowlensDir: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(await readFile(join(flowlensDir, 'manifest.json'), 'utf-8')) as Partial<GraphManifest>;
    if (manifest.finished_at) return manifest.finished_at;
  } catch {
    /* no manifest yet (written by Lane A's indexer) */
  }
  try {
    return (await stat(join(flowlensDir, 'graph'))).mtime.toISOString();
  } catch {
    return null;
  }
}

export async function computeSummary(graph: GraphStore, flowlensDir: string): Promise<CanvasSummary> {
  const [entities, relations] = await Promise.all([graph.getAllNodes(), graph.getAllEdges()]);
  const entities_by_kind: Record<string, number> = {};
  const files = new Set<string>();
  for (const e of entities) {
    entities_by_kind[e.kind] = (entities_by_kind[e.kind] ?? 0) + 1;
    if (e.kind !== 'module' && e.file) files.add(e.file);
  }
  const relations_by_type: Record<string, number> = {};
  for (const r of relations) relations_by_type[r.type] = (relations_by_type[r.type] ?? 0) + 1;

  const config = await loadSavedArchitecture(flowlensDir);
  const [cycles, violations, indexedAt] = await Promise.all([
    detectCycles(graph, { granularity: 'file' }).catch(() => []),
    config ? validateArchitecture(graph, config).catch(() => []) : Promise.resolve([]),
    lastIndexed(flowlensDir),
  ]);

  return {
    file_count: files.size,
    entity_count: entities.length,
    relation_count: relations.length,
    cycle_count: cycles.length,
    violation_count: violations.length,
    last_indexed: indexedAt,
    entities_by_kind,
    relations_by_type,
  };
}

/**
 * Hotspots from the metrics stored on entities at index time
 * (`hotspot_score` = churn × cognitive complexity). No git call at request time.
 */
export async function computeHotspotList(graph: GraphStore, limit: number): Promise<CanvasHotspotsResponse> {
  const [entities, relations] = await Promise.all([graph.getAllNodes(), graph.getAllEdges()]);
  const dependents = new Map<string, Set<string>>();
  for (const r of relations) {
    let set = dependents.get(r.to);
    if (!set) dependents.set(r.to, (set = new Set()));
    set.add(r.from);
  }
  const all: CanvasHotspot[] = [];
  for (const e of entities) {
    const m = e.metrics;
    if (!m?.hotspot_score) continue;
    all.push({
      entity_id: e.id,
      entity_name: e.name,
      entity_kind: e.kind,
      file: e.file,
      hotspot_score: m.hotspot_score,
      churn_rate: m.churn_rate ?? 0,
      cognitive_complexity: m.cognitive_complexity ?? 0,
      dependent_count: dependents.get(e.id)?.size ?? 0,
    });
  }
  all.sort((a, b) => b.hotspot_score - a.hotspot_score || a.entity_id.localeCompare(b.entity_id));
  return { hotspots: all.slice(0, Math.max(0, limit)), total: all.length };
}
