/**
 * Parser truth 2, item 2: `recv.method()` through receivers whose declared type
 * is knowable from syntax. Precision over recall: every negative case here is a
 * place where a wrong edge would be easy to make.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource } from '../../../helpers/parse-relations.js';

/** Member calls only (those carrying a receiver). */
const calls = async (code: string, file = 'src/a.ts') => (await parseSource(code, file)).lines(['call']).filter((l) => l.includes(' @'));

describe('same-file typed receivers', () => {
  it('const x = new Foo(); x.bar()', async () => {
    expect(await calls(`class Foo { bar() {} }\nexport function run() { const x = new Foo(); x.bar(); }`))
      .toEqual(['call run -> Foo.bar @x']);
  });

  it('annotated locals, parameters and optional chaining / non-null / as', async () => {
    expect(await calls([
      'class Foo { bar() {} baz() {} qux() {} }',
      'export function a(f: Foo) { f.bar(); }',
      'export function b(f?: Foo | null) { f?.baz(); f!.baz(); }',
      'export function c(u: unknown) { (u as Foo).qux(); }',
      'export function d() { let f: Foo; f.bar(); }',
    ].join('\n'))).toEqual([
      'call a -> Foo.bar @f', 'call b -> Foo.baz x2 @f', 'call c -> Foo.qux @(u as Foo)', 'call d -> Foo.bar @f',
    ]);
  });

  it('this.dep.method() through a typed field, an initialised field and a constructor parameter property', async () => {
    expect(await calls([
      'class Dep { go() {} }',
      'class Other { run() {} }',
      'class Svc {',
      '  private dep: Dep;',
      '  private readonly other = new Other();',
      '  constructor(private readonly third: Dep, plain: Dep) {}',
      '  work() { this.dep.go(); this.other.run(); this.third.go(); this.plain.go(); }',
      '}',
    ].join('\n'))).toEqual([
      // this.dep.go() and this.third.go() aggregate into one edge (weight 2); this.plain is not a property
      'call Svc.work -> Dep.go x2 @this.dep', 'call Svc.work -> Other.run @this.other',
    ]);
  });

  it('module-level singleton declared below the function that uses it', async () => {
    expect(await calls('class Store { get() {} }\nexport function f() { return store.get(); }\nconst store = new Store();'))
      .toEqual(['call f -> Store.get @store']);
  });

  it('destructured parameter typed by a same-file interface', async () => {
    expect(await calls([
      'class Discovery { session() {} }',
      'class Actions { run() {} }',
      'interface Opts { discovery: Discovery; actions?: Actions; name: string }',
      'export function createApp({ discovery, actions = new Actions(), name }: Opts) {',
      '  discovery.session(); actions.run(); name.trim();',
      '}',
      'export function viaObject(deps: Opts) { deps.discovery.session(); }',
    ].join('\n'))).toEqual([
      'call createApp -> Actions.run @actions', 'call createApp -> Discovery.session @discovery',
      'call viaObject -> Discovery.session @deps.discovery',
    ]);
  });

  it('inherited members through a same-file parent class (resolved in pass 2)', async () => {
    const p = await parseSource('class Base { hello() {} }\nclass Child extends Base {}\nexport function f(c: Child) { c.hello(); }');
    expect(p.lines(['call'])).toEqual(['call f -> ?Child.hello @c']);
    expect(p.pending[0].optional).toBeFalsy();
  });

  it('new Foo().bar()', async () => {
    expect(await calls('class Foo { bar() {} }\nexport function f() { new Foo().bar(); }')).toEqual(['call f -> Foo.bar @new Foo()']);
  });

  it('marks module-scope member calls as module-owned', async () => {
    const p = await parseSource('class Foo { bar() {} }\nconst x = new Foo();\nx.bar();');
    expect(p.find('call', 'src/a.ts', 'Foo.bar')?.meta).toEqual({ receiver: 'x', owner: 'module' });
  });
});

describe('precision: nothing is recorded when the type is not declared', () => {
  const cases: Record<string, string> = {
    'untyped parameter': 'class Foo { bar() {} }\nexport function f(x) { x.bar(); }',
    'result of a call': 'class Foo { bar() {} }\nfunction make() { return new Foo(); }\nexport function f() { const x = make(); x.bar(); }',
    'let initialised with new (reassignable)': 'class Foo { bar() {} }\nexport function f() { let x = new Foo(); x.bar(); }',
    'destructured local': 'class Foo { bar() {} }\nexport function f(o) { const { x } = o; x.bar(); }',
    'union of two classes': 'class A { m() {} }\nclass B { m() {} }\nexport function f(x: A | B) { x.m(); }',
    'array of class': 'class Foo { bar() {} }\nexport function f(x: Foo[]) { x.bar(); }',
    'unknown / any': 'class Foo { bar() {} }\nexport function f(x: any, y: unknown) { x.bar(); (y as any).bar(); }',
    'untyped field': 'class Foo { bar() {} }\nclass S { dep; work() { this.dep.bar(); } }',
    'type parameter': 'export function f<T>(x: T) { x.bar(); }',
    'builtin type': 'export function f(m: Map<string, number>, s: string) { m.get("a"); s.trim(); }',
  };
  for (const [name, code] of Object.entries(cases)) {
    it(name, async () => { expect(await calls(code)).toEqual([]); });
  }

  it('a local that shadows a module-level typed name hides it', async () => {
    expect(await calls([
      'class Store { get() {} }',
      'const store = new Store();',
      'export function a(store) { store.get(); }',
      'export function b() { const store = makeOther(); store.get(); }',
      'export function c() { for (const store of []) store.get(); }',
      'export function d() { try {} catch (store) { store.get(); } }',
      'export function ok() { store.get(); }',
    ].join('\n'))).toEqual(['call ok -> Store.get @store']);
  });

  it('a name declared twice in a function becomes unknown after the second declaration (block scoping is ignored on purpose)', async () => {
    // the first x.go() is inside the block that declares `x = new A()`: correct. The second is not recorded.
    expect(await calls([
      'class A { go() {} }\nclass B { go() {} }',
      'export function f(c: boolean) { if (c) { const x = new A(); x.go(); } else { const x = new B(); x.go(); } }',
    ].join('\n'))).toEqual(['call f -> A.go @x']);
  });

  it('a nested function shadows the outer typed name', async () => {
    expect(await calls([
      'class Foo { bar() {} }',
      'export function f(x: Foo) { function g(x) { x.bar(); } x.bar(); }',
    ].join('\n'))).toEqual(['call f -> Foo.bar @x']);
  });

  it('arrow-function parameters shadow too', async () => {
    expect(await calls('class Foo { bar() {} }\nexport function f(x: Foo) { return [1].map((x) => x.bar()); }'))
      .toEqual([]);
  });
});

describe('imported receivers', () => {
  const root = mkdtempSync(join(tmpdir(), 'fl-mc-'));
  for (const f of ['d.ts', 'api.ts']) writeFileSync(join(root, f), 'export class Discovery {}\nexport class Repo {}\nexport const api = {};\n');
  const parseIn = (code: string) => parseSource(code, 'a.ts', root);
  const memberPending = (p: Awaited<ReturnType<typeof parseSource>>) => p.pending.filter((x) => x.type === 'call');

  it('typed receivers of an imported class become pending Type.method (optional = false)', async () => {
    const p = await parseIn("import { Discovery } from './d.js';\nexport function f(d: Discovery) { d.session(); }");
    expect(p.lines(['call'])).toEqual(['call f -> ?Discovery.session @d']);
    const [call] = memberPending(p);
    expect(call.optional).toBeFalsy();
    expect(call.confidence).toBeCloseTo(0.9);
    expect(call.meta?.receiver).toBe('d');
  });

  it('builtin-looking methods on typed receivers are optional (never a dashed leaf)', async () => {
    const p = await parseIn("import { Repo } from './d.js';\nexport function f(r: Repo) { r.get(1); r.map(); r.load(); }");
    const byName = Object.fromEntries(memberPending(p).map((x) => [x.target_name, !!x.optional]));
    expect(byName).toEqual({ 'Repo.get': true, 'Repo.map': true, 'Repo.load': false });
  });

  it('plain `name.method()` on a project import is a strict reference; dotted receivers and builtin names stay optional', async () => {
    const p = await parseIn([
      "import { api } from './api.js';",
      'export function f() { api.workspace(); api.sub.call(); api.get(); }',
    ].join('\n'));
    const byName = Object.fromEntries(memberPending(p).map((x) => [x.target_name, !!x.optional]));
    expect(byName).toEqual({ 'api.workspace': false, 'api.sub.call': true, 'api.get': true });
    expect(memberPending(p).find((x) => x.target_name === 'api.workspace')?.meta?.receiver).toBe('api');
  });

  it('a parameter named like an import does not link to the import', async () => {
    expect(await parseIn("import { api } from './api.js';\nexport function f(api) { api.workspace(); }").then((p) => p.lines(['call']))).toEqual([]);
  });

  it('external packages are dropped, as before', async () => {
    expect(await calls("import { z } from 'zod';\nexport function f() { z.object({}); }")).toEqual([]);
  });

  it('namespace imports keep their old behaviour (no receiver marker)', async () => {
    const p = await parseIn("import * as ns from './api.js';\nexport function f() { ns.run(); }");
    const [call] = memberPending(p);
    expect(call.target_name).toBe('ns.run');
    expect(call.optional).toBeFalsy();
    expect(call.meta?.receiver).toBeUndefined();
  });
});
