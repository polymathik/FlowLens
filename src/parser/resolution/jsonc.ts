/**
 * Tolerant JSON-with-comments parser for tsconfig.json / jsconfig.json.
 *
 * tsconfig files routinely contain `//` and `/* *\/` comments and trailing
 * commas, which `JSON.parse` rejects. We strip both (respecting string
 * literals) and parse; on any failure we return null rather than throw, so
 * a malformed config degrades to "no path mapping" instead of failing the
 * index run.
 */
import { readFileSync } from 'node:fs';

export function stripJsonComments(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Remove commas that directly precede `}` or `]` (outside strings). */
export function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') { out += text[++i] ?? ''; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

export function parseJsonc<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(stripTrailingCommas(stripJsonComments(text))) as T;
  } catch {
    return null;
  }
}

export function readJsonc<T = unknown>(file: string): T | null {
  try {
    return parseJsonc<T>(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}
