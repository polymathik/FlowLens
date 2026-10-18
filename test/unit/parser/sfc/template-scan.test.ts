import { describe, it, expect } from 'vitest';
import { scanTemplate } from '../../../../src/parser/sfc/template-scan.js';

const names = (r: Array<{ name: string }>) => r.map((x) => x.name);

describe('scanTemplate (svelte)', () => {
  const src = [
    '<script>import A from "./A.svelte"; // <Hidden /> in script</script>',
    '<!-- <InComment /> -->',
    '<A x={format(1)} />',
    '<ui.Button onclick={() => save(item)}>don\'t {label(it)} </ui.Button>',
    '<svelte:head><title>{title("a (b)")}</title></svelte:head>',
    '<div>{#if ok(user)}<Child />{/if}</div>',
    '<style>.a::after { content: "<NotATag>" }</style>',
  ].join('\n');

  it('finds component tags only (not html, svelte:*, comments, script or style)', () => {
    expect(names(scanTemplate(src, 'svelte').tags)).toEqual(['A', 'ui.Button', 'Child']);
  });

  it('reports 1-based line/column of tags', () => {
    const tag = scanTemplate(src, 'svelte').tags.find((t) => t.name === 'ui.Button')!;
    expect(tag).toMatchObject({ line: 4, column: 2 });
  });

  it('finds calls inside expressions, ignoring strings and member calls', () => {
    const calls = scanTemplate(src, 'svelte').calls;
    expect(names(calls)).toEqual(['format', 'save', 'label', 'title', 'ok']);
    expect(calls[0]).toMatchObject({ line: 3, column: 7 });
  });

  it('does not treat text outside braces as code', () => {
    expect(scanTemplate('<p>call me (maybe) or foo(bar)</p>', 'svelte').calls).toEqual([]);
  });
});

describe('scanTemplate (vue)', () => {
  const src = [
    '<template>',
    '  <MyComp :a="fmt(x)" @click="go()" v-if="ok(a, \'z(1)\')" class="plain(x)" />',
    '  <my-badge />',
    '  <div>{{ label() }} {{ obj.method() }}</div>',
    '</template>',
  ].join('\n');

  it('finds PascalCase and kebab-case components', () => {
    expect(names(scanTemplate(src, 'vue').tags)).toEqual(['MyComp', 'my-badge']);
  });

  it('reads {{ }} and directive/binding attribute values, not plain attributes', () => {
    expect(names(scanTemplate(src, 'vue').calls)).toEqual(['fmt', 'go', 'ok', 'label', 'obj.method']);
  });
});
