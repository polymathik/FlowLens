/**
 * Mermaid `graph LR` exporter. Node identifiers must be alphanumeric +
 * underscore — we slugify entity IDs to `n0`, `n1`, ... because entity IDs
 * often contain slashes and colons that Mermaid can't parse. The human
 * label carries the entity name + kind + quality score.
 */
import type { GraphExporter, ExportInput } from '../contracts/export.js';
import type { Entity } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';

export const mermaidExporter: GraphExporter = {
  export({ entities, relations }: ExportInput): string {
    const idMap = new Map<string, string>();
    entities.forEach((e, i) => idMap.set(e.id, `n${i}`));

    const lines: string[] = ['graph LR'];

    for (const entity of entities) {
      const alias = idMap.get(entity.id)!;
      lines.push(`  ${alias}[${quoteLabel(entityLabel(entity))}]`);
    }

    for (const relation of relations) {
      const from = idMap.get(relation.from);
      const to = idMap.get(relation.to);
      if (!from || !to) continue;
      lines.push(`  ${from} -->|${safeEdgeLabel(relation)}| ${to}`);
    }

    return lines.join('\n') + '\n';
  },
};

function entityLabel(entity: Entity): string {
  const qs = entity.metrics?.quality_score;
  return `${entity.name}<br/>(${entity.kind}${qs !== undefined ? `, QS:${qs}` : ''})`;
}

/** Mermaid text labels must be quoted when they contain HTML or parens. */
function quoteLabel(label: string): string {
  return `"${label.replace(/"/g, '&quot;')}"`;
}

/** Edge labels — strip characters that confuse the Mermaid parser. */
function safeEdgeLabel(relation: Relation): string {
  return relation.type.replace(/[|<>]/g, '');
}
