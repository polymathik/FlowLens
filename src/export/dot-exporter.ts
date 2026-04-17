/**
 * Graphviz DOT exporter. Produces a digraph with LR rankdir, box-shape
 * nodes labeled `name\n(kind, QS:score)`, and edges labeled by relation
 * type. Identifiers are quoted so names with special characters survive.
 */
import type { GraphExporter, ExportInput } from '../contracts/export.js';

export const dotExporter: GraphExporter = {
  export({ entities, relations }: ExportInput): string {
    const lines: string[] = ['digraph FlowLens {', '  rankdir=LR;', '  node [shape=box];'];

    for (const entity of entities) {
      const qs = entity.metrics?.quality_score;
      const labelParts = [entity.name, `(${entity.kind}${qs !== undefined ? `, QS:${qs}` : ''})`];
      const label = labelParts.join('\\n');
      lines.push(`  ${quote(entity.id)} [label=${quote(label)}];`);
    }

    for (const relation of relations) {
      lines.push(
        `  ${quote(relation.from)} -> ${quote(relation.to)} [label=${quote(relation.type)}];`,
      );
    }

    lines.push('}');
    return lines.join('\n') + '\n';
  },
};

/** Quote + escape for DOT. Backslashes and double quotes need escaping. */
function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
