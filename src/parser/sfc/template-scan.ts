/**
 * Template scanner for single-file components: finds what the markup uses
 * from the script scope.
 *
 *  - component tags: `<Zone />`, `<ui.Button>` (Svelte); `<MyComp>`, `<my-comp>` (Vue)
 *  - calls inside template expressions: `{format(x)}`, `onclick={() => save()}`
 *    (Svelte `{…}`), `{{ format(x) }}` and `:prop="f(x)"` / `@click="go()"` / `v-if="ok()"` (Vue)
 *
 * Purely lexical and conservative: string literals inside expressions are
 * blanked first, only identifiers directly followed by `(` count as calls,
 * and the caller drops every name that is not an import or a local entity.
 */
import { blankMatches, type SfcFlavor } from './blocks.js';

export interface TemplateRef { name: string; line: number; column: number }
export interface TemplateScan { tags: TemplateRef[]; calls: TemplateRef[] }

const NON_CODE_BLOCKS = [
  /<!--[\s\S]*?-->/g,
  /<script\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/script\s*>/gi,
  /<style\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/style\s*>/gi,
];

const RESERVED = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'void', 'await', 'new', 'delete',
  'in', 'of', 'as', 'import', 'super', 'this', 'async', 'else', 'each', 'key', 'then', 'html', 'render',
  '$state', '$derived', '$effect', '$props', '$bindable', '$inspect', '$host',
]);

/** 1-based line/column of `offset` in `text`. */
function position(lineStarts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

/** Blank the inside of '…', "…" and `…` literals (length preserved) so braces and parens inside strings are inert. */
function blankStrings(expr: string): string {
  return expr.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[m.length - 1]);
}

/**
 * Balanced `{…}` regions of Svelte markup, as [start, end) offsets of the inside.
 * Quotes only matter inside a region (text like `don't` outside braces is not a string).
 */
function svelteExpressions(markup: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let depth = 0;
  let start = 0;
  let quote = '';
  for (let i = 0; i < markup.length; i++) {
    const ch = markup[i];
    if (depth === 0) {
      if (ch === '{') { depth = 1; start = i + 1; }
      continue;
    }
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) out.push([start, i]);
  }
  return out;
}

/** `{{ … }}` and directive/binding attribute values of Vue markup. */
function vueExpressions(markup: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of markup.matchAll(/\{\{([\s\S]*?)\}\}/g)) out.push([m.index! + 2, m.index! + 2 + m[1].length]);
  for (const m of markup.matchAll(/\s(?::|@|v-)[\w:.@[\]-]*\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const value = m[1] ?? m[2];
    out.push([m.index! + m[0].length - value.length - 1, m.index! + m[0].length - 1]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function isComponentTag(name: string, flavor: SfcFlavor): boolean {
  if (name.includes(':') && flavor === 'svelte') return false; // svelte:self, svelte:head …
  if (/^[A-Z]/.test(name)) return true;
  if (flavor === 'svelte') return name.includes('.'); // <ui.Button>
  return name.includes('-'); // Vue kebab-case components
}

export function scanTemplate(content: string, flavor: SfcFlavor): TemplateScan {
  let markup = content;
  for (const re of NON_CODE_BLOCKS) markup = blankMatches(markup, new RegExp(re.source, re.flags));
  const starts = lineStartsOf(content);
  const tags: TemplateRef[] = [];
  const calls: TemplateRef[] = [];

  for (const m of markup.matchAll(/<([A-Za-z][\w$.:-]*)/g)) {
    if (isComponentTag(m[1], flavor)) tags.push({ name: m[1], ...position(starts, m.index! + 1) });
  }

  const regions = flavor === 'svelte' ? svelteExpressions(markup) : vueExpressions(markup);
  const seen = new Set<string>();
  for (const [from, to] of regions) {
    const expr = blankStrings(markup.slice(from, to));
    for (const m of expr.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)) {
      if (RESERVED.has(m[1])) continue;
      const pos = position(starts, from + m.index!);
      const key = `${m[1]}@${pos.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      calls.push({ name: m[1], ...pos });
    }
  }
  return { tags, calls };
}
