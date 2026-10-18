import { describe, it, expect } from 'vitest';
import { AstGrepParser } from '../../../../src/parser/ast-grep-parser.js';
import { componentNameOf } from '../../../../src/parser/sfc/sfc-parser.js';

const parser = new AstGrepParser('');

describe('single-file components', () => {
  it('registers .svelte and .vue as languages the parser supports', () => {
    expect(parser.supportsExtension('.svelte')).toBe(true);
    expect(parser.supportsExtension('.vue')).toBe(true);
    expect(parser.hasDeepExtractor('svelte')).toBe(true);
  });

  it('script-less component: file + component entity, default export, no failure', async () => {
    const r = await parser.parseFile('ui/Icon.svelte', '<svg>\n</svg>\n');
    expect(r.failed).toBeUndefined();
    expect(r.entities.map((e) => `${e.kind}:${e.name}`)).toEqual(['file:Icon.svelte', 'component:Icon']);
    expect(r.entities[0]).toMatchObject({ language: 'svelte', file_role: 'source' });
    expect(r.symbols?.exports).toEqual([{ name: 'default', local: 'Icon' }]);
    expect(r.symbols?.implicit_exports).toBeUndefined();
  });

  it('keeps original line and column numbers for script symbols (script starts mid-file, same-line content)', async () => {
    const src = ['<p>top</p>', '', '<script lang="ts">export function one(): number { return 1; }', '', 'function two() {}', '</script>'].join('\n');
    const r = await parser.parseFile('A.svelte', src);
    const one = r.entities.find((e) => e.name === 'one')!;
    const two = r.entities.find((e) => e.name === 'two')!;
    expect(one.location.line_start).toBe(3);
    expect(one.location.column_start).toBe(src.split('\n')[2].indexOf('function') + 1); // 1-based, as in a .ts file
    expect(two.location.line_start).toBe(5);
    expect(r.symbols?.exports).toEqual(expect.arrayContaining([{ name: 'one', local: 'one' }, { name: 'default', local: 'A' }]));
  });

  it('top-level script calls belong to the component entity', async () => {
    const src = '<script>\n  function helper() {}\n  helper();\n</script>';
    const r = await parser.parseFile('B.svelte', src);
    const comp = r.entities.find((e) => e.kind === 'component')!;
    const helper = r.entities.find((e) => e.name === 'helper')!;
    expect(r.relations.some((x) => x.type === 'call' && x.from === comp.id && x.to === helper.id)).toBe(true);
  });

  it('does not make a component use itself, and drops tags that are not imports or locals', async () => {
    const r = await parser.parseFile('Self.svelte', '<script>import X from "react";</script>\n<Self /><Unknown /><X />');
    expect(r.relations.filter((x) => x.type === 'create')).toEqual([]);
    expect((r.pending ?? []).filter((x) => x.type === 'create')).toEqual([]);
  });

  it('survives a script with syntax errors (warning, entities kept)', async () => {
    const r = await parser.parseFile('Bad.vue', '<script setup lang="ts">\nfunction ok() {}\nlet = = ;\n</script>');
    expect(r.failed).toBeUndefined();
    expect(r.syntax_errors).toBeGreaterThan(0);
    expect(r.entities.some((e) => e.name === 'ok')).toBe(true);
  });

  it('names components after the file', () => {
    expect(componentNameOf('a/b/Zone.svelte')).toBe('Zone');
    expect(componentNameOf('a/Foo.bar.vue')).toBe('Foo_bar');
    expect(componentNameOf('routes/+page.svelte')).toBe('+page');
  });

  it('is deterministic: same input, same entity ids', async () => {
    const src = '<script>function a() {}</script>';
    const one = await parser.parseFile('D.svelte', src);
    const two = await parser.parseFile('D.svelte', src);
    expect(one.entities.map((e) => e.id)).toEqual(two.entities.map((e) => e.id));
    expect(new Set(one.entities.map((e) => e.id)).size).toBe(one.entities.length);
  });
});
