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
