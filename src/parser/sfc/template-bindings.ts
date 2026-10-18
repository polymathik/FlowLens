/**
 * Handler / action / binding references in single-file component markup.
 *
 *   Svelte  onclick={save}  on:click|once={save}  use:tooltip  bind:value={name}
 *           <Child onsave={save} />   {@attach fn}
 *   Vue     @click="save"  v-on:click="save"  v-model="name"  :render="draw"
 *
 * Calls inside template expressions (`{fn(x)}`) are found by template-scan.ts;
 * this module finds the *bare name* forms, where a script function is handed to
 * the markup without being called. Purely lexical and conservative:
 *  - only a lone identifier counts (`onclick={() => save()}`, `@click="n++"`,
 *    `{a.b}` are expressions and left to the call scan),
 *  - names introduced by the markup itself (`{#each xs as save}`,
 *    `{#snippet row(save)}`, `{:then save}`, `{@const save = …}`, `let:save`,
 *    Vue `v-for` / `v-slot` / `slot-scope`) are collected file-wide as
 *    template locals and never reported, even where the scope would not
 *    actually shadow (a lost edge beats a wrong one),
 *  - the caller drops every name that is not an import or a script entity.
 */
import type { SfcFlavor } from './blocks.js';

export type BindingKind = 'handler' | 'bind' | 'prop' | 'action';

export interface BindingRef {
  name: string;
  /** Attribute / directive as written (`onclick`, `on:click`, `bind:value`, `use:tooltip`, `@click`). */
  via: string;
  kind: BindingKind;
  /** Offset of the identifier in the (blanked) markup. */
  offset: number;
}

const IDENT = '[A-Za-z_$][\\w$]*';
/** Attributes whose braces never carry a code reference worth an edge. */
const PLAIN_ATTRS = new Set(['class', 'style', 'id', 'key', 'href', 'src', 'alt', 'title', 'name', 'value', 'type', 'role']);

function svelteBindings(markup: string): BindingRef[] {
  const out: BindingRef[] = [];
  const attr = new RegExp(`(?<=[\\s"'])([A-Za-z_$][\\w$.:|-]*)\\s*=\\s*\\{\\s*(${IDENT})\\s*\\}`, 'g');
  for (const m of markup.matchAll(attr)) {
    const via = m[1].split('|')[0];
    const offset = m.index! + m[0].lastIndexOf(m[2]);
    if (via === 'bind:this') continue; // a DOM handle, not a dependency
    if (via.startsWith('bind:')) out.push({ name: m[2], via, kind: 'bind', offset });
    else if (via.startsWith('on:') || /^on[a-z]/.test(via)) out.push({ name: m[2], via, kind: 'handler', offset });
    else if (!via.includes(':') && !PLAIN_ATTRS.has(via)) out.push({ name: m[2], via, kind: 'prop', offset });
  }
  const directive = new RegExp(`(?<=[\\s"'])(use|transition|in|out|animate):(${IDENT}(?:\\.${IDENT})*)`, 'g');
  for (const m of markup.matchAll(directive)) {
    out.push({ name: m[2], via: `${m[1]}:${m[2]}`, kind: 'action', offset: m.index! + m[1].length + 1 });
  }
  for (const m of markup.matchAll(new RegExp(`\\{@attach\\s+(${IDENT})\\s*\\}`, 'g'))) {
    out.push({ name: m[1], via: '@attach', kind: 'action', offset: m.index! + m[0].lastIndexOf(m[1]) });
  }
  return out;
}

function vueBindings(markup: string): BindingRef[] {
  const out: BindingRef[] = [];
  const attr = new RegExp(`(?<=[\\s"'])(@[\\w:.-]+|v-on:[\\w:.-]+|v-model[\\w:.-]*|v-bind:[\\w.-]+|:[\\w.-]+)\\s*=\\s*(?:"\\s*(${IDENT})\\s*"|'\\s*(${IDENT})\\s*')`, 'g');
  for (const m of markup.matchAll(attr)) {
    const name = m[2] ?? m[3];
    const via = m[1].split('.')[0];
    const offset = m.index! + m[0].lastIndexOf(name);
    if (via.startsWith('v-model')) out.push({ name, via, kind: 'bind', offset });
    else if (via.startsWith('@') || via.startsWith('v-on:')) out.push({ name, via, kind: 'handler', offset });
    else if (!PLAIN_ATTRS.has(via.replace(/^(?:v-bind)?:/, ''))) out.push({ name, via, kind: 'prop', offset });
  }
  return out;
}

/** Identifier tokens of a binding pattern (`item`, `{ id, name: n }`, `a, i`). */
function identifiersOf(pattern: string): string[] {
  return pattern.match(/[A-Za-z_$][\w$]*/g) ?? [];
}

/** Names the markup declares itself (loop variables, snippet parameters, slot props). */
export function templateLocals(markup: string, flavor: SfcFlavor): Set<string> {
  const locals = new Set<string>();
  const add = (pattern: string | undefined): void => { for (const id of identifiersOf(pattern ?? '')) locals.add(id); };
  if (flavor === 'svelte') {
    for (const m of markup.matchAll(/\{#each\s[^}]*?\sas\s+([^}]*?)\s*\}/g)) add(m[1].replace(/\([^)]*\)\s*$/, ''));
    for (const m of markup.matchAll(/\{#snippet\s+([\w$]+)\s*\(([^)]*)\)/g)) { add(m[1]); add(m[2]); }
    for (const m of markup.matchAll(/\{(?:#await\s[^}]*?\s)?(?::?then|:catch)\s+([^}]*?)\s*\}/g)) add(m[1]);
    for (const m of markup.matchAll(/\{@const\s+([^=}]+?)\s*=/g)) add(m[1]);
    for (const m of markup.matchAll(/\slet:([\w$]+)(?:\s*=\s*\{([^}]*)\})?/g)) { add(m[1]); add(m[2]); }
  } else {
    for (const m of markup.matchAll(/\sv-for\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const expr = m[1] ?? m[2];
      add(expr.split(/\s+(?:in|of)\s+/)[0]);
    }
    for (const m of markup.matchAll(/\s(?:v-slot(?::[\w.-]+)?|#[\w.-]+|slot-scope)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) add(m[1] ?? m[2]);
  }
  return locals;
}

export function scanBindings(markup: string, flavor: SfcFlavor): BindingRef[] {
  return flavor === 'svelte' ? svelteBindings(markup) : vueBindings(markup);
}
