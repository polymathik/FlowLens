/**
 * Export facade — given an `ExportOptions` and a graph store, pick the right
 * format exporter and return the rendered string. Callers that want to
 * write to a file should use the CLI command; this module stays pure so
 * it's reusable (tests, MCP tools, programmatic API).
 */
import type { GraphExporter, ExportOptions, ExportResult } from '../contracts/export.js';
import type { Entity } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';
import { filterForExport } from './scope-filter.js';
import { jsonExporter } from './json-exporter.js';
import { dotExporter } from './dot-exporter.js';
import { mermaidExporter } from './mermaid-exporter.js';
import { mermaidSizeWarnings } from './mermaid-size-guard.js';

const EXPORTERS: Record<ExportOptions['format'], GraphExporter> = {
  json: jsonExporter,
  dot: dotExporter,
  mermaid: mermaidExporter,
};

export function exportGraph(
  entities: Entity[],
  relations: Relation[],
  options: ExportOptions,
): string {
  return renderExport(entities, relations, options).output;
}

/** Like `exportGraph`, plus non-fatal warnings (Mermaid size guard). */
export function renderExport(
  entities: Entity[],
  relations: Relation[],
  options: ExportOptions,
): ExportResult {
  const filtered = filterForExport(entities, relations, options);
  const exporter = EXPORTERS[options.format];
  if (!exporter) {
    throw new Error(`Unknown export format: ${options.format}`);
  }
  const output = exporter.export({ ...filtered, options });
  const warnings =
    options.format === 'mermaid'
      ? mermaidSizeWarnings(output, filtered.entities, filtered.relations.length)
      : [];
  return {
    output,
    warnings,
    entity_count: filtered.entities.length,
    relation_count: filtered.relations.length,
  };
}

export { jsonExporter, dotExporter, mermaidExporter, mermaidSizeWarnings };
