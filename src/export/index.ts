/**
 * Export facade — given an `ExportOptions` and a graph store, pick the right
 * format exporter and return the rendered string. Callers that want to
 * write to a file should use the CLI command; this module stays pure so
 * it's reusable (tests, MCP tools, programmatic API).
 */
import type { GraphExporter, ExportOptions } from '../contracts/export.js';
import type { Entity } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';
import { filterForExport } from './scope-filter.js';
import { jsonExporter } from './json-exporter.js';
import { dotExporter } from './dot-exporter.js';
import { mermaidExporter } from './mermaid-exporter.js';

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
  const filtered = filterForExport(entities, relations, options);
  const exporter = EXPORTERS[options.format];
  if (!exporter) {
    throw new Error(`Unknown export format: ${options.format}`);
  }
  return exporter.export({ ...filtered, options });
}

export { jsonExporter, dotExporter, mermaidExporter };
