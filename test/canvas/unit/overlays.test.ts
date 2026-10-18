import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { applyOverlay, markProblemEdges } from '../../../src/canvas/overlays/apply-overlay.js';
import type { NodeOverlayStyle } from '../../../src/contracts/canvas/index.js';
import { sampleHierarchy } from '../helpers/factories.js';

const { index, viewAt } = sampleHierarchy();
const SRC = ['folder:src'];
const overlayOf = (nodes: Node[], id: string) => (nodes.find((n) => n.id === id)?.data as { overlay?: NodeOverlayStyle }).overlay;
const view = (path: string[]) => viewAt(path);

describe('metric overlays', () => {
  const { nodes } = view(SRC);

  it('no overlay leaves nodes untouched', () => {
    expect(applyOverlay(nodes, null, {}, index)).toBe(nodes);
  });

  it('churn colours nodes with churn and mutes the rest', () => {
    const out = applyOverlay(nodes, 'churn-heatmap', {}, index);
    expect(overlayOf(out, 'folder:src/core')).toMatchObject({ tag: 'churn' });
    expect(overlayOf(out, 'folder:src/core')?.muted).toBeFalsy();
    expect(overlayOf(out, 'folder:src/ui')).toMatchObject({ tag: 'churn', muted: true });
  });

  it('hotspot scales the hottest node up (inside the body, not the RF wrapper)', () => {
    const out = applyOverlay(nodes, 'hotspot', {}, index);
    const core = out.find((n) => n.id === 'folder:src/core')!;
    expect(overlayOf(out, 'folder:src/core')?.scale).toBeCloseTo(1.6);
    expect(overlayOf(out, 'folder:src/api')?.scale).toBeLessThan(1.6);
    expect(core.style?.transform).toBeUndefined();
  });

  it('complexity uses the quality band colour', () => {
    const out = applyOverlay(nodes, 'complexity-heatmap', {}, index);
    expect(overlayOf(out, 'folder:src/core')?.stroke).toBe('var(--fl-heat-poor)'); // 40 → needs care (theme token)
  });
});

describe('cycles and violations map to the visible level', () => {
  const cycles = [{ entities: ['src/ui/view.ts', 'src/ui/widgets.ts'] }];
  const violations = [{ entity_from: 'handle', entity_to: 'render' }];

  it('a file-path cycle inside one folder marks that folder one level up (no edge)', () => {
    const { nodes, edges, visibleIds } = view(SRC);
    expect(overlayOf(applyOverlay(nodes, 'cycles', { cycles }, index), 'folder:src/ui')).toMatchObject({ tag: 'cycles', strokeStyle: 'dashed' });
    expect(markProblemEdges(edges, 'cycles', { cycles }, index, visibleIds).filter((e) => e.type === 'cycle')).toHaveLength(0);
  });

  it('inside the module both file edges become cycle edges', () => {
    const { edges, visibleIds } = view(['folder:src', 'folder:src/ui']);
    const marked = markProblemEdges(edges, 'cycles', { cycles }, index, visibleIds).filter((e) => e.type === 'cycle');
    expect(marked.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
      'file:src/ui/view.ts->file:src/ui/widgets.ts',
      'file:src/ui/widgets.ts->file:src/ui/view.ts',
    ]);
    expect(marked[0].data?.is_cycle).toBe(true);
  });

  it('entity-id violations aggregate to module nodes and their edge', () => {
    const { nodes, edges, visibleIds } = view(SRC);
    const decorated = applyOverlay(nodes, 'architecture-violations', { violations }, index);
    expect(overlayOf(decorated, 'folder:src/api')?.badge).toBe('1 rule break');
    expect(overlayOf(decorated, 'folder:src/ui')?.tag).toBe('violations');
    const marked = markProblemEdges(edges, 'architecture-violations', { violations }, index, visibleIds);
    expect(marked.filter((e) => e.type === 'violation').map((e) => `${e.source}->${e.target}`)).toEqual(['folder:src/api->folder:src/ui']);
  });

  it('diff entries resolve to the visible ancestor with the most severe change', () => {
    const { nodes } = view(SRC);
    const out = applyOverlay(nodes, 'interface-diff', { diffChanges: [{ entity_id: 'Store', change_type: 'added' }, { entity_id: 'Store', change_type: 'removed' }] }, index);
    expect(overlayOf(out, 'folder:src/core')?.badge).toBe('removed');
  });
});

describe('overlay colours follow the theme (Phase 12)', () => {
  it('every light token has a dark-mode value in both dark blocks', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../../../src/canvas/styles/tokens.css', import.meta.url), 'utf8');
    const blocks = css.split(/\n(?=@media|:root\[data-theme='dark'\])/);
    const names = (b: string) => new Set([...b.matchAll(/(--fl-(?:heat|overlay|diff|minimap)[\w-]*):/g)].map((m) => m[1]));
    const light = names(blocks[0]);
    expect(light.size).toBeGreaterThan(10);
    for (const dark of blocks.slice(1, 3)) expect([...light].filter((n) => !names(dark).has(n))).toEqual([]);
  });

  it('soft fills of tokens use color-mix', async () => {
    const { withAlpha, churnColor } = await import('../../../src/canvas/utils/color-scales');
    expect(withAlpha('var(--fl-heat-bad)', 0.16)).toBe('color-mix(in srgb, var(--fl-heat-bad) 16%, transparent)');
    expect(withAlpha('#112233', 1)).toBe('#112233ff');
    expect(churnColor(1, 2)).toBe('color-mix(in srgb, var(--fl-heat-churn-high) 50%, var(--fl-heat-churn-low))');
  });
});
