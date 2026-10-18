/**
 * Parser truth 2, item 5: handlers, actions and bindings handed to the markup by
 * name (`onclick={save}`, `use:tip`, `bind:value={x}`, `@click="save"`).
 */
import { describe, it, expect } from 'vitest';
import { scanTemplate } from '../../../../src/parser/sfc/template-scan.js';
import { parseSource } from '../../../helpers/parse-relations.js';

const rendered = (src: string, flavor: 'svelte' | 'vue') =>
  scanTemplate(src, flavor).bindings.map((b) => `${b.kind} ${b.via} ${b.name}`);

describe('scanTemplate bindings (svelte)', () => {
  it('finds handlers, binds, actions and function-valued props', () => {
    expect(rendered([
      '<input bind:value={name} bind:this={el} />',
      '<button onclick={save} on:click|once={close} use:tooltip class={cls}>go</button>',
      '<Child onsave={save} render={draw} {shorthand} />',
      '<p transition:fade>x</p>',
    ].join('\n'), 'svelte').sort()).toEqual([
      'action transition:fade fade',
      'action use:tooltip tooltip',
      'bind bind:value name',
      'handler on:click close',
      'handler onclick save',
      'handler onsave save',
      'prop render draw',
    ]);
  });

  it('ignores expressions, plain attributes, bind:this and script text', () => {
    expect(rendered([
      '<script>const x = <b onclick={nope} />;</script>',
      '<button onclick={() => save()} class={cls} id={ident} title={t}>{save}</button>',
      '<input bind:this={el} bind:value={form.name} />',
      '<!-- <i onclick={hidden} /> -->',
    ].join('\n'), 'svelte')).toEqual([]);
  });

  it('never reports names the markup declares itself (each / snippet / await / const / let:)', () => {
    const src = [
      '{#each items as item, i (item.id)}<b onclick={item} onhover={i} />{/each}',
      '{#each rows as { id, label }}<b onclick={label} />{/each}',
      '{#snippet row(cell)}<i onclick={cell} />{/snippet}',
      '{#await p then data}<i onclick={data} />{:catch err}<i onclick={err} />{/await}',
      '{@const picked = pick()}<i onclick={picked} />',
      '<Slot let:thing><i onclick={thing} /></Slot>',
      '<i onclick={save} />',
    ].join('\n');
    expect(rendered(src, 'svelte')).toEqual(['handler onclick save']);
  });

  it('drops calls on template locals as well', () => {
    const calls = scanTemplate('{#each fns as fn}{fn(1)}{/each}{real(2)}', 'svelte').calls.map((c) => c.name);
    expect(calls).toEqual(['real']);
  });
});

describe('scanTemplate bindings (vue)', () => {
  it('finds @handlers, v-model and function-valued props, not expressions', () => {
    expect(rendered([
      '<template>',
      '  <input v-model="name" @input="save" :render="draw" :class="cls" :key="id" />',
      '  <Child @done="finish" v-on:close.once="close" @go="go()" @n="count++" :obj="a.b" />',
      '</template>',
    ].join('\n'), 'vue')).toEqual([
      'bind v-model name', 'handler @input save', 'prop :render draw', 'handler @done finish', 'handler v-on:close close',
    ]);
  });

  it('never reports v-for variables or slot props', () => {
    const src = [
      '<li v-for="(row, i) in rows" @click="row" :render="i" />',
      '<Cell #default="{ pick }"><b @click="pick" /></Cell>',
      '<b @click="save" />',
    ].join('\n');
    expect(rendered(src, 'vue')).toEqual(['handler @click save']);
  });
});

describe('template bindings become use edges of the component', () => {
  it('svelte: resolves script functions, variables and imported actions; skips unknown names', async () => {
    const p = await parseSource([
      '<script lang="ts">',
      '  import { tooltip } from "./actions.js";',
      '  let name = $state("");',
      '  function save() {}',
      '</script>',
      '<input bind:value={name} />',
      '<button onclick={save} use:tooltip onfocus={missing}>go</button>',
    ].join('\n'), 'src/Comp.svelte');
    expect(p.lines(['use'])).toEqual([
      'use Comp -> ?tooltip ~binding:use:tooltip',
      'use Comp -> name ~binding:bind:value',
      'use Comp -> save ~binding:onclick',
    ]);
  });

  it('vue: resolves handlers declared in <script setup>', async () => {
    const p = await parseSource([
      '<script setup lang="ts">',
      'function save() {}',
      'const draw = () => {};',
      '</script>',
      '<template><b @click="save" :render="draw" v-for="draw in xs" /></template>',
    ].join('\n'), 'src/Comp.vue');
    // `draw` is also a v-for variable: dropped (file-wide, conservative); save stays
    expect(p.lines(['use'])).toEqual(['use Comp -> save ~binding:@click']);
  });
});

describe('script-level hand-offs in a component', () => {
  it('keep recording variable arguments (the component owns its script body)', async () => {
    const p = await parseSource([
      '<script lang="ts">',
      '  const POLL_MS = 1000;',
      '  function tick() {}',
      '  setInterval(tick, POLL_MS);',
      '</script>',
    ].join('\n'), 'src/Comp.svelte');
    expect(p.lines(['use'])).toEqual([
      'use Comp -> POLL_MS [module] ~argument:setInterval',
      'use Comp -> tick [module] ~argument:setInterval',
    ]);
  });
});
