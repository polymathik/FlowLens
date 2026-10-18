/**
 * Parser truth 2, item 4: module-scope statements and anonymous callbacks get an
 * owner (the file entity, marked meta.owner = 'module') instead of disappearing.
 */
import { describe, it, expect } from 'vitest';
import { parseSource } from '../../../helpers/parse-relations.js';

describe('module-scope owners', () => {
  it('attributes a top-level call to the file entity', async () => {
    const p = await parseSource(`function main() {}\nmain();\n`);
    expect(p.lines(['call'])).toEqual(['call src/a.ts -> main [module]']);
    const r = p.relations.find((x) => x.type === 'call')!;
    expect(r.meta).toEqual({ owner: 'module' });
    expect(p.entities.find((e) => e.id === r.from)?.kind).toBe('file');
  });

  it('attributes calls inside module-scope callbacks (app.get / program.command) to the file', async () => {
    const p = await parseSource([
      'function work() {}',
      'function other() {}',
      'app.get("/x", (c) => work());',
      'program.command("go").action(function () { other(); });',
    ].join('\n'));
    expect(p.lines(['call'])).toEqual(['call src/a.ts -> other [module]', 'call src/a.ts -> work [module]']);
  });

  it('keeps callbacks inside a named function with that function (not module-owned)', async () => {
    const p = await parseSource([
      'function work() {}',
      'export function run(items: number[]) {',
      '  items.forEach(() => work());',
      '  const inner = () => work();',
      '}',
    ].join('\n'));
    expect(p.lines(['call'])).toEqual(['call run -> work x2']);
    expect(p.relations.find((r) => r.type === 'call')?.meta?.owner).toBeUndefined();
  });

  it('records module-scope `new` (create) and `throw new`', async () => {
    const p = await parseSource('class Svc {}\nclass Boom extends Error {}\nconst s = new Svc();\nif (!s) throw new Boom();\n');
    expect(p.lines(['create', 'throw'])).toEqual(['create src/a.ts -> Svc [module]', 'throw src/a.ts -> Boom [module]']);
  });

  it('does not record plain module-scope reads (no noise)', async () => {
    const p = await parseSource('const A = 1;\nconst B = A + 1;\nexport default B;\n');
    expect(p.lines(['use'])).toEqual([]);
  });

  it('module-scope calls through imports become pending relations owned by the file', async () => {
    const p = await parseSource("import { boot } from './boot.js';\nboot();\n");
    expect(p.lines(['call'])).toEqual(['call src/a.ts -> ?boot [module]']);
  });

  it('an anonymous default export function belongs to the module', async () => {
    const p = await parseSource('function a() {}\nexport default function () { a(); }\n');
    expect(p.lines(['call'])).toEqual(['call src/a.ts -> a [module]']);
  });

  it('works for a single-file component: top-level script calls belong to the component', async () => {
    const p = await parseSource('<script lang="ts">\n function load() {}\n load();\n</script>\n<p>x</p>\n', 'src/C.svelte');
    expect(p.lines(['call'])).toEqual(['call C -> load [module]']);
  });
});
