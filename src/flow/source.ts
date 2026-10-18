/**
 * Source-text helpers for the detectors (pure string work, no I/O).
 *
 * The extractors do not keep module-scope registrations such as
 * `app.get('/x', handler)` (no relation, no route path), so detectors look
 * at the text of a few candidate files. These helpers make that safe on real
 * code: balanced-bracket scanning that skips strings, template literals and
 * comments, and top-level argument splitting.
 */

/** Reads a repo-relative file; undefined when unreadable. Injected so detectors stay pure. */
export type SourceProvider = (file: string) => string | undefined;

export interface Segment { start: number; end: number }

/** 1-based line of `offset`, given the text's line-start table. */
export function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

export function lineAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Index just past a string / template literal that starts at `i` (a quote character). */
function skipString(text: string, i: number): number {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\') j += 2;
    else if (c === quote) return j + 1;
    else if (quote === '`' && c === '$' && text[j + 1] === '{') {
      const close = matchBracket(text, j + 1);
      j = close < 0 ? text.length : close + 1;
    } else if (c === '\n' && quote !== '`') return j; // unterminated: stop at the line end
    else j++;
  }
  return text.length;
}

/** Index past a comment starting at `i`, or `i` when there is none. */
function skipComment(text: string, i: number): number {
  if (text[i] !== '/') return i;
  if (text[i + 1] === '/') {
    const nl = text.indexOf('\n', i);
    return nl < 0 ? text.length : nl;
  }
  if (text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end < 0 ? text.length : end + 2;
  }
  return i;
}

const CLOSERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/** Index of the bracket matching the opener at `open`, or -1. Skips strings and comments. */
export function matchBracket(text: string, open: number): number {
  const stack: string[] = [];
  let i = open;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(text, i);
      continue;
    }
    if (c === '/') {
      const after = skipComment(text, i);
      if (after !== i) {
        i = after;
        continue;
      }
    }
    if (c === '(' || c === '[' || c === '{') stack.push(CLOSERS[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Top-level comma-separated argument segments between the call parens `(open … close)`. */
export function splitArgs(text: string, open: number, close: number): Segment[] {
  const out: Segment[] = [];
  let depth = 0;
  let start = open + 1;
  let i = open + 1;
  while (i < close) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(text, i);
      continue;
    }
    if (c === '/') {
      const after = skipComment(text, i);
      if (after !== i) {
        i = after;
        continue;
      }
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push({ start, end: i });
      start = i + 1;
    } else if (c === '=' && text[i + 1] === '>') i++; // `=>`: the `>` is not a bracket
    i++;
  }
  if (text.slice(start, close).trim() !== '') out.push({ start, end: close });
  return out;
}

export function trimSegment(text: string, seg: Segment): Segment {
  let { start, end } = seg;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
}

/** Value of a plain string / template literal without `${}`; null for anything else. */
export function stringLiteral(text: string): string | null {
  const m = text.trim().match(/^(['"`])((?:\\.|(?!\1)[^\\])*)\1$/s);
  if (!m || (m[1] === '`' && m[2].includes('${'))) return null;
  return m[2];
}

/** `async (a, b) => …`, `function (…) {…}`, `x => …`: an inline callback rather than a reference. */
export function isInlineFunction(text: string): boolean {
  return /^(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::\s*[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/s.test(text.trim());
}

/** `handler` / `ctrl.list` / `this.list` / `list.bind(this)`: a reference to a named function. */
export function referenceName(text: string): { name: string; qualifier?: string } | null {
  const m = text.trim().match(/^(?:await\s+)?((?:[A-Za-z_$][\w$]*\.)*)([A-Za-z_$][\w$]*)(?:\.bind\([^)]*\))?$/);
  if (!m) return null;
  const qualifier = m[1] ? m[1].slice(0, -1) : undefined;
  return { name: m[2], ...(qualifier ? { qualifier } : {}) };
}

/** Skip whitespace and comments forward from `i`. */
export function skipTrivia(text: string, i: number): number {
  let j = i;
  for (;;) {
    while (j < text.length && /\s/.test(text[j])) j++;
    const after = skipComment(text, j);
    if (after === j) return j;
    j = after;
  }
}
