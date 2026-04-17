/**
 * Export contract — defines the shape exporters must satisfy to render
 * a FlowLens graph in JSON, Graphviz DOT, or Mermaid format.
 *
 * Exporters are pure: they receive an already-filtered set of entities +
 * relations and produce a string. Scope filtering happens in a shared
 * helper so each format exporter only concerns itself with serialization.
 */
import type { Entity } from './entities.js';
import type { Relation, RelationType } from './relations.js';

export type ExportFormat = 'json' | 'dot' | 'mermaid';

export interface ExportOptions {
  format: ExportFormat;
  /** Limit to files starting with this prefix (e.g. "src/auth/"). */
  scope?: string;
  /** Only include these relation types. Default: all. */
  relation_types?: RelationType[];
  /** When true, JSON output includes `metrics` on each entity. */
  include_metrics?: boolean;
  /** When set, write to file path instead of returning string. */
  output?: string;
}

export interface ExportInput {
  entities: Entity[];
  relations: Relation[];
  options: ExportOptions;
}

export interface GraphExporter {
  /** Render the filtered graph in the exporter's format. */
  export(input: ExportInput): string;
}
