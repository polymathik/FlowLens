/**
 * Parser truth 2, item 6: function members of a module-level object literal are
 * `method` entities, and calls inside them belong to them.
 */
import { describe, it, expect } from 'vitest';
import { parseSource } from '../../../helpers/parse-relations.js';

const SRC = [
  'function work() {}',
  'function other() {}',
  'export const svc = {',
  '  load: () => work(),',
  '  async save(id: string) { other(); this.x; return svc.load(); },',
  '  tick: function () { work(); },',
  '  count: 3,',
  '  nested: { deep: () => other() },',
  '  get label() { return work(); },',
  '  ...rest,',
  '};',
  'svc.load();',
].join('\n');

describe('object-literal service members', () => {
  it('creates method entities for function members only, with parameters, contained by the variable', async () => {
    const p = await parseSource(SRC);
    const names = p.entities.filter((e) => e.qualified_name.startsWith('src/a.ts/svc.')).map((e) => `${e.kind} ${e.qualified_name.slice('src/a.ts/'.length)}`).sort();
    expect(names).toEqual(['method svc.load', 'method svc.save', 'method svc.tick', 'parameter svc.save.id']);
    expect(p.lines(['contain'])).toEqual(['contain svc -> svc.load', 'contain svc -> svc.save', 'contain svc -> svc.tick']);
    expect(p.entities.find((e) => e.name === 'save')?.annotations).toEqual({ member: 'object' });
  });

  it('attributes calls inside members to the member, resolves svc.load() in the same file', async () => {
    const p = await parseSource(SRC);
    expect(p.lines(['call'])).toEqual([
      'call src/a.ts -> other [module]', // nested.deep: not an entity, so the module owns it
      'call src/a.ts -> svc.load [module]',
      'call src/a.ts -> work [module]', // the getter: not an entity either
      'call svc.load -> work',
      'call svc.save -> other',
      'call svc.save -> svc.load',
      'call svc.tick -> work',
    ]);
  });

  it('ignores objects that are not module-level literals and members of nested objects', async () => {
    const p = await parseSource([
      'function work() {}',
      'function f() { const local = { go: () => work() }; local.go(); }',
      'const made = create({ run: () => work() });',
      'const arr = [1].map(() => work());',
    ].join('\n'));
    expect(p.entities.filter((e) => e.kind === 'method')).toEqual([]);
    expect(p.lines(['call'])).toEqual(['call f -> work', 'call src/a.ts -> work [module] x2']);
  });

  it('looks through `as const` / `satisfies` wrappers', async () => {
    const p = await parseSource('function work() {}\nexport const h = { a: () => work() } as const;\nconst k = { b() { work(); } } satisfies Record<string, unknown>;\n');
    expect(p.entities.filter((e) => e.kind === 'method').map((e) => e.qualified_name).sort()).toEqual(['src/a.ts/h.a', 'src/a.ts/k.b']);
  });
});
