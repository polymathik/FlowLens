/**
 * Call sites inside an inline handler's line span.
 *
 * The graph aggregates relations per (from, type, to) and keeps only the FIRST
 * call site, so a callee used in several handlers of one function (e.g. a
 * `parseSessionId()` called by every route of `createApp`) has its recorded
 * line in just one of them. For a flow rooted in an inline handler we ask the
 * source whether the edge's callee is called inside the span, and where.
 * The hop is then marked `source_scan` with a reduced confidence.
 */

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface SpanSite {
  /** First line (1-based) of a call to the callee inside the span. */
  line: number;
  /** Calls found inside the span. */
  count: number;
}

/** Calls to `name(` / `new name(` / `this.name(` in lines [from, to] of `text`; null when none. */
export function callsInSpan(text: string, name: string, from: number, to: number): SpanSite | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  const lines = text.split('\n');
  const re = new RegExp(`(?<![\\w$.])(?:this\\.)?(?:new\\s+)?${escapeRe(name)}\\s*(?:<[^<>()]*>)?\\s*\\(`, 'g');
  let first = 0;
  let count = 0;
  for (let l = Math.max(1, from); l <= Math.min(lines.length, to); l++) {
    const code = lines[l - 1].replace(/\/\/.*$/, '');
    const n = [...code.matchAll(re)].length;
    if (n === 0) continue;
    if (first === 0) first = l;
    count += n;
  }
  return first === 0 ? null : { line: first, count };
}
