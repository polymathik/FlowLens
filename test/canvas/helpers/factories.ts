/** Small Entity / Relation factories for canvas unit tests. */
import type { Entity, EntityKind } from '../../../src/contracts/entities.js';
import type { Relation, RelationType } from '../../../src/contracts/relations.js';

export function entity(id: string, file: string, kind: EntityKind = 'function', metrics: Entity['metrics'] = { line_count: 1 }): Entity {
  return {
    id,
    kind,
    name: id,
    qualified_name: `${file}/${id}`,
    file,
    location: { line_start: 1, line_end: 2, column_start: 0, column_end: 0 },
    visibility: 'public',
    language: 'typescript',
    metrics,
  };
}

let rid = 0;
export function relation(from: string, to: string, type: RelationType = 'import'): Relation {
  rid++;
  return { id: `r${rid}`, from, to, type, location: { file: 'x', line: 1, column: 0 }, weight: 1, confidence: 1 };
}

/**
 * A two-system graph:
 *   src/api/routes.ts  (handle)  → src/core/store.ts (Store)  [call]
 *   src/api/routes.ts  (handle)  → src/ui/view.ts (render)    [import]
 *   src/ui/view.ts     (render)  → src/ui/widgets.ts (badge)  [call]
 *   src/ui/widgets.ts  (badge)   → src/ui/view.ts (render)    [call]
 *   src/core/store.ts  (Store)   → lib/util/strings.ts (slug) [import]
 *   src/index.ts       (main)    → src/api/routes.ts (handle) [call]
 */
export function sampleGraph() {
  const entities: Entity[] = [
    entity('handle', 'src/api/routes.ts', 'function', { line_count: 5, quality_score: 90, churn_rate: 0.02, hotspot_score: 0.1, cognitive_complexity: 5 }),
    entity('Store', 'src/core/store.ts', 'class', { line_count: 20, quality_score: 40, churn_rate: 0.05, hotspot_score: 0.6, cognitive_complexity: 12 }),
    entity('render', 'src/ui/view.ts'),
    entity('badge', 'src/ui/widgets.ts'),
    entity('slug', 'lib/util/strings.ts'),
    entity('main', 'src/index.ts'),
    entity('p1', 'src/core/store.ts', 'parameter'),
    entity('mod-ui', 'src/ui', 'module'),
    entity('file-view', 'src/ui/view.ts', 'file'),
    entity('file-widgets', 'src/ui/widgets.ts', 'file'),
  ];
  const relations: Relation[] = [
    relation('handle', 'Store', 'call'),
    relation('handle', 'render', 'import'),
    relation('render', 'badge', 'call'),
    relation('badge', 'render', 'call'),
    relation('Store', 'slug', 'import'),
    relation('main', 'handle', 'call'),
    relation('file-view', 'file-widgets', 'import'),
  ];
  return { entities, relations };
}

/** Hierarchy + view model helpers shared by the Map v2 unit tests. */
import { buildHierarchy } from '../../../src/analysis/hierarchy/index.js';
import { computeMapView } from '../../../src/canvas/utils/map-view.js';
import { buildViewEdges, applyRelationFilter } from '../../../src/canvas/utils/edge-transformer.js';
import { buildViewNodes, buildAnnotationMap } from '../../../src/canvas/utils/node-transformer.js';
import { buildGraphIndex } from '../../../src/canvas/utils/graph-index.js';

export function sampleHierarchy() {
  const g = sampleGraph();
  const hierarchy = buildHierarchy({ projectName: 'Sample', entities: g.entities });
  const index = buildGraphIndex(g.entities, hierarchy);
  const relationById = new Map(g.relations.map((r) => [r.id, r]));
  /** Everything the canvas derives for the container opened by `drillPath`. */
  const viewAt = (drillPath: string[], showLockfiles = false) => {
    const view = computeMapView(hierarchy, g.relations, drillPath, { showLockfiles });
    const nodes = buildViewNodes({ hierarchy, entityById: index.entityById, annotations: buildAnnotationMap() }, view);
    const edges = buildViewEdges(view, relationById);
    return { view, nodes, edges, visibleIds: new Set(nodes.map((n) => n.id)) };
  };
  return { ...g, hierarchy, index, relationById, viewAt, applyRelationFilter };
}
