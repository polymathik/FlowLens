export type EntityKind =
  | 'file' | 'module' | 'namespace' | 'class' | 'interface'
  | 'function' | 'method' | 'variable' | 'field' | 'parameter'
  | 'type' | 'enum' | 'enum_member' | 'decorator';

export type Location = {
  line_start: number;
  line_end: number;
  column_start: number;
  column_end: number;
};

export type Visibility = 'public' | 'private' | 'protected' | 'internal';

export type EntityMetrics = {
  line_count: number;
  cognitive_complexity?: number;
  quality_score?: number;
  cyclomatic_complexity?: number;
  halstead_volume?: number;
  halstead_difficulty?: number;
  halstead_bugs?: number;
  afferent_coupling?: number;
  efferent_coupling?: number;
  instability?: number;
  churn_rate?: number;
  hotspot_score?: number;
};

/**
 * Identity rules (Phase 8):
 * - `qualified_name` = `{file}/{Scope.Path}.{name}`, where the scope path
 *   lists every enclosing named declaration: `src/a.ts/Cls.method`,
 *   parameters `src/a.ts/fn.param` / `src/a.ts/Cls.method.param`,
 *   decorators `src/a.ts/Cls.method.@Dec`. Files use the bare path; modules
 *   use the directory path.
 * - `id` = `generateEntityId(file, qualified_name, kind)`; every reference to
 *   an entity (including cross-file relation targets) must use the same
 *   inputs. Ids are unique across the graph; duplicate declarations in one
 *   file (overloads, redefinitions) collapse to the first declaration.
 * - `metrics.cognitive_complexity` is undefined (absent) for languages
 *   without a verified implementation — never a fabricated 0.
 */
export type Entity = {
  id: string;
  kind: EntityKind;
  name: string;
  qualified_name: string;
  file: string;
  location: Location;
  visibility: Visibility;
  language: string;
  metrics?: EntityMetrics;
  annotations?: Record<string, string>;
};
