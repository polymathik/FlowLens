/**
 * Mermaid size guard — warns (never fails) when a rendered diagram exceeds
 * what mermaid.js renders by default, and suggests how to scope it down.
 * The suggestion names the busiest top-level directories so the user gets a
 * concrete `--scope` to try instead of a generic "too big".
 */
import { MERMAID_LIMITS } from '../contracts/export.js';
import type { Entity } from '../contracts/entities.js';

export function mermaidSizeWarnings(
  output: string,
  entities: Entity[],
  edgeCount: number,
  limits: { maxTextSize: number; maxEdges: number } = MERMAID_LIMITS,
): string[] {
  const overText = output.length > limits.maxTextSize;
  const overEdges = edgeCount > limits.maxEdges;
  if (!overText && !overEdges) return [];

  const reasons: string[] = [];
  if (overText) {
    reasons.push(`${output.length.toLocaleString('en-US')} chars > ${limits.maxTextSize.toLocaleString('en-US')}`);
  }
  if (overEdges) reasons.push(`${edgeCount} edges > ${limits.maxEdges}`);

  const dirs = topDirectories(entities, 3);
  const scopeHint = dirs.length
    ? `try --scope ${dirs.map((d) => `"${d}"`).join(' or --scope ')}`
    : 'try --scope <dir>';
  return [
    `Mermaid diagram is larger than the default renderer allows (${reasons.join(', ')}); ` +
      'GitHub/Mermaid Live will show "Maximum text size exceeded".',
    `Narrow it: ${scopeHint}, and/or --relations import. ` +
      'For the full graph use --format dot or --format json.',
  ];
}

/** Most-populated directory prefixes (two levels deep, e.g. "src/auth/"). */
function topDirectories(entities: Entity[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const e of entities) {
    const parts = e.file.split('/');
    if (parts.length < 2) continue;
    const depth = Math.min(parts.length - 1, 2);
    const prefix = parts.slice(0, depth).join('/') + '/';
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([prefix]) => prefix);
}
