/**
 * Relations contributed by a single-file component's markup (the component is
 * the owner):
 *   - `create` component → component for `<Child />` tags that match an import
 *     (or a same-file entity),
 *   - `call` for calls inside template expressions (`{format(x)}`),
 *   - `use` (`meta.ref: 'binding'`, `ref_via` = the attribute) for functions and
 *     variables handed to the markup by name: `onclick={save}`, `on:click`,
 *     `use:tooltip`, `bind:value={name}`, Vue `@click="save"`, `v-model`.
 * Everything is optional except tags: a name that is neither an import nor a
 * script entity is dropped silently (see template-scan.ts for the lexical rules).
 */
import type { Entity, EntityKind } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import type { FileSymbols } from '../../contracts/symbols.js';
import { RelationEmitter } from '../symbols/emitter.js';
import type { SfcFlavor } from './blocks.js';
import { scanTemplate, type TemplateRef } from './template-scan.js';
import type { BindingKind } from './template-bindings.js';

const BINDING_KINDS: Record<BindingKind, EntityKind[]> = {
  handler: ['function', 'method', 'variable'],
  bind: ['variable', 'field'],
  prop: ['function', 'method'],
  action: ['function', 'variable'],
};

/** Candidate binding names for a tag: as written, PascalCase, camelCase (Vue kebab-case tags). */
function tagCandidates(name: string, flavor: SfcFlavor): string[] {
  if (flavor !== 'vue' || !name.includes('-')) return [name];
  const pascal = name.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return [pascal, pascal.charAt(0).toLowerCase() + pascal.slice(1), name];
}

export function templateRelations(
  content: string, flavor: SfcFlavor, component: Entity, entities: Entity[], symbols: FileSymbols,
): Relation[] {
  const emitter = new RelationEmitter(component.file, entities, symbols);
  const scan = scanTemplate(content, flavor);
  const at = (r: TemplateRef) => ({ line: r.line, column: r.column });
  for (const tag of scan.tags) {
    const name = tagCandidates(tag.name, flavor).find((c) => {
      const head = c.split('.')[0];
      return emitter.isImported(head) || (emitter.isLocal(head) && head !== component.name);
    });
    if (name) emitter.link(component, 'create', name, at(tag), { kinds: ['component', 'class'] });
  }
  for (const call of scan.calls) emitter.link(component, 'call', call.name, at(call), { optional: true });
  for (const b of scan.bindings) {
    const head = b.name.split('.')[0];
    if (head === component.name || (!emitter.isImported(head) && !emitter.isLocal(head))) continue;
    emitter.link(component, 'use', b.name, at(b), {
      optional: true, kinds: BINDING_KINDS[b.kind], meta: { ref: 'binding', ref_via: b.via },
    });
  }
  return emitter.relations;
}
