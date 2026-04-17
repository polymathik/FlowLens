import type { GraphExporter, ExportInput } from '../contracts/export.js';

/** Export format version — bumped when the JSON schema changes. */
export const JSON_EXPORT_VERSION = '1.0.0';

/**
 * JSON exporter. Produces a self-describing document with version header,
 * timestamp, and the filtered entity/relation lists. Strips `metrics` from
 * entities when `include_metrics` is false.
 */
export const jsonExporter: GraphExporter = {
  export({ entities, relations, options }: ExportInput): string {
    const includeMetrics = options.include_metrics ?? true;
    const serialEntities = includeMetrics
      ? entities
      : entities.map((e) => {
          const { metrics: _m, ...rest } = e;
          return rest;
        });

    const payload = {
      version: JSON_EXPORT_VERSION,
      exported_at: new Date().toISOString(),
      entities: serialEntities,
      relations,
    };
    return JSON.stringify(payload, null, 2);
  },
};
