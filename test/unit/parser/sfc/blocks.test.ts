import { describe, it, expect } from 'vitest';
import { findScriptBlocks, maskToScript } from '../../../../src/parser/sfc/blocks.js';

describe('maskToScript', () => {
  const svelte = [
    '<!-- <script>const ghost = 1;</script> -->',
    '<script context="module" lang="ts">',
    '  export const A = 1;',
    '</script>',
    '<script lang="ts" generics="T extends Record<string, unknown>">',
    '  let { x }: { x: T } = $props();',
    '</script>',
    '<p>{x}</p>',
    '<style>p { color: red } /* <script>nope</script> */</style>',
  ].join('\n');

  it('keeps line structure and the exact position of every script character', () => {
    const m = maskToScript(svelte);
    expect(m.source.length).toBe(svelte.length);
    expect(m.source.split('\n').length).toBe(svelte.split('\n').length);
    const lines = m.source.split('\n');
    expect(lines[2]).toBe('  export const A = 1;');
    expect(lines[5]).toBe('  let { x }: { x: T } = $props();');
    expect(lines[0].trim()).toBe('');   // comment blanked
    expect(lines[7].trim()).toBe('');   // markup blanked
    expect(m.source).not.toContain('ghost');
    expect(m.source).not.toContain('nope');
  });

  it('classifies module / instance / setup blocks and picks a grammar from lang', () => {
    expect(maskToScript(svelte).blocks.map((b) => b.kind)).toEqual(['module', 'instance']);
    expect(maskToScript(svelte).grammar).toBe('TypeScript');
    expect(findScriptBlocks('<script module>let a;</script>')[0].kind).toBe('module');
    expect(findScriptBlocks('<script setup lang="ts">let a;</script><script>let b;</script>').map((b) => b.kind)).toEqual(['setup', 'instance']);
    expect(maskToScript('<script lang="tsx">1</script>').grammar).toBe('Tsx');
    expect(maskToScript('<script lang="coffee">x</script>').grammar).toBeNull();
    expect(maskToScript('<p>no script</p>')).toMatchObject({ grammar: null, blocks: [] });
  });

  it('ignores external scripts and handles CRLF', () => {
    expect(findScriptBlocks('<script src="./x.ts"></script>')).toEqual([]);
    const m = maskToScript('<script>\r\nlet a = 1;\r\n</script>\r\n<p/>');
    expect(m.source.split('\r\n')[1]).toBe('let a = 1;');
  });
});
