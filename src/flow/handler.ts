/**
 * Turn the "handler" argument of a registration call into something
 * traceable: a named function the graph knows, or an inline callback
 * (identified by its line range inside the enclosing entity).
 */
import type { Entity } from '../contracts/entities.js';
import type { HandlerSpan } from '../contracts/flow.js';
import type { FlowGraph } from './graph.js';
import { resolveName } from './resolve-name.js';
import { isInlineFunction, lineAt, referenceName, trimSegment, type Segment } from './source.js';

export interface HandlerTarget {
  entity: Entity;
  span?: HandlerSpan;
  confidence: number;
  /** Fragment appended to the entry point's evidence. */
  how: string;
}

export interface ArgContext {
  graph: FlowGraph;
  file: string;
  text: string;
  starts: number[];
}

/**
 * Resolve one argument. Never null for a file the graph knows: when the
 * handler cannot be found the file entity stands in (low confidence), so the
 * registration itself is still listed.
 */
export function resolveHandler(ctx: ArgContext, seg: Segment, registrationLine: number): HandlerTarget | null {
  const { graph, file, text, starts } = ctx;
  const fileEntity = graph.fileEntity.get(file);
  if (!fileEntity) return null;
  const t = trimSegment(text, seg);
  const src = text.slice(t.start, t.end);

  if (isInlineFunction(src)) {
    const span = { line_start: lineAt(starts, t.start), line_end: lineAt(starts, t.end) };
    const scope = graph.enclosing(file, registrationLine);
    return scope
      ? { entity: scope, span, confidence: 0.85, how: `inline handler inside ${scope.name}` }
      : { entity: fileEntity, span, confidence: 0.7, how: 'inline handler at module scope (calls read from source)' };
  }
  const ref = referenceName(src);
  if (!ref) return { entity: fileEntity, confidence: 0.4, how: `handler expression not recognised (${src.slice(0, 40)})` };

  const matches = resolveName(graph, { file, name: ref.name, qualifier: ref.qualifier, line: registrationLine });
  if (matches.length === 0) return { entity: fileEntity, confidence: 0.4, how: `handler '${ref.qualifier ? `${ref.qualifier}.` : ''}${ref.name}' not found in the graph` };
  const best = matches[0];
  const unique = matches.length === 1;
  return {
    entity: best.entity,
    confidence: unique ? (best.how === 'member' && ref.qualifier !== 'this' ? 0.8 : 0.95) : 0.6,
    how: `handler ${best.entity.name} resolved ${best.how === 'self' ? 'in the same file' : best.how === 'import' ? 'via import' : 'as a member'}${unique ? '' : ` (${matches.length} candidates, took the nearest)`}`,
  };
}
