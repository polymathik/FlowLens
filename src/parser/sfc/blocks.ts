/**
 * Single-file component block scanner (`.svelte`, `.vue`).
 *
 * A component file is HTML-like markup with top-level `<script>` and
 * `<style>` blocks. Instead of slicing the script out (which would shift
 * line numbers), `maskToScript` returns a document of the *same length and
 * line structure* where everything except the script bodies is replaced by
 * spaces. The TypeScript extractor then runs on it unchanged and every
 * entity line/column already matches the original file.
 *
 *  - Svelte: `<script>` (instance), `<script module>` / `<script context="module">`
 *  - Vue:    `<script>` and `<script setup>` (may coexist)
 *  - `lang="ts"` / `lang="tsx"` select the TypeScript grammar.
 * Docs: https://svelte.dev/docs/svelte/svelte-files · https://vuejs.org/api/sfc-spec.html
 */
export type SfcFlavor = 'svelte' | 'vue';

export interface ScriptBlock {
  attrs: Record<string, string | true>;
  /** Offset of the first character of the block body in the file. */
  start: number;
  body: string;
  kind: 'instance' | 'module' | 'setup';
}

const ATTRS = '((?:[^>"\']|"[^"]*"|\'[^\']*\')*)';
const SCRIPT_RE = new RegExp(`<script\\b${ATTRS}>([\\s\\S]*?)<\\/script\\s*>`, 'gi');
const STYLE_RE = new RegExp(`<style\\b${ATTRS}>[\\s\\S]*?<\\/style\\s*>`, 'gi');
const COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Replace every non-newline character of matches with a space (offsets and lines preserved). */
export function blankMatches(text: string, re: RegExp): string {
  return text.replace(re, (m) => m.replace(/[^\r\n]/g, ' '));
}

function parseAttrs(raw: string): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  const re = /([\w:.@-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) out[m[1]] = m[2] ?? m[3] ?? m[4] ?? true;
  return out;
}

function kindOf(attrs: Record<string, string | true>): ScriptBlock['kind'] {
  if ('setup' in attrs) return 'setup';
  if ('module' in attrs || attrs.context === 'module') return 'module';
  return 'instance';
}

/** Top-level `<script>` blocks, ignoring ones inside comments or `<style>`. */
export function findScriptBlocks(content: string): ScriptBlock[] {
  const clean = blankMatches(blankMatches(content, COMMENT_RE), STYLE_RE);
  const blocks: ScriptBlock[] = [];
  const re = new RegExp(SCRIPT_RE.source, SCRIPT_RE.flags);
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    const attrs = parseAttrs(m[1]);
    if (typeof attrs.src === 'string') continue; // external script: nothing to read here
    const start = m.index + `<script${m[1]}>`.length;
    blocks.push({ attrs, start, body: content.slice(start, start + m[2].length), kind: kindOf(attrs) });
  }
  return blocks;
}

export interface MaskedScript {
  /** Same line structure as the input; only script bodies keep their text. */
  source: string;
  /**
   * Grammar to parse `source` with, or null when there is no script / an unsupported `lang`.
   * Plain `<script>` also uses the TypeScript grammar: it is a superset of JavaScript and
   * tolerates type annotations that tooling accepts without `lang="ts"`.
   */
  grammar: 'TypeScript' | 'Tsx' | 'JavaScript' | null;
  blocks: ScriptBlock[];
}

export function maskToScript(content: string): MaskedScript {
  const blocks = findScriptBlocks(content);
  const chars = content.replace(/[^\r\n]/g, ' ').split('');
  for (const b of blocks) for (let i = 0; i < b.body.length; i++) chars[b.start + i] = b.body[i];
  const langs = blocks.map((b) => (typeof b.attrs.lang === 'string' ? b.attrs.lang.toLowerCase() : 'js'));
  let grammar: MaskedScript['grammar'] = null;
  if (blocks.length > 0) {
    if (langs.some((l) => l === 'tsx' || l === 'jsx')) grammar = 'Tsx';
    else if (langs.every((l) => ['ts', 'typescript', 'js', 'javascript'].includes(l))) grammar = 'TypeScript';
  }
  return { source: chars.join(''), grammar, blocks };
}
