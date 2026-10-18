import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { CanvasEdgeData, FileNodeData, ZoneNodeData } from '../../../src/contracts/canvas/index.js';
import { PROJECT_NODE_ID } from '../../../src/contracts/hierarchy.js';
import { computeMapView } from '../../../src/canvas/utils/map-view';
import { buildCutNodes } from '../../../src/canvas/utils/zone-nodes';
import { buildLives } from '../../../src/canvas/timeline/lives';
import { DELETED_DIR, GHOST_CAP, ghostPaths, withGhosts } from '../../../src/canvas/timeline/ghost-hierarchy';
import { buildItemMap, chainOf } from '../../../src/canvas/timeline/items';
import { buildFrame } from '../../../src/canvas/timeline/frame';
import { decorateEdges, decorateNodes } from '../../../src/canvas/timeline/decorate';
import { historyOf, STORY } from '../helpers/history-fixture';
import { zoneFixture } from '../helpers/zone-fixture';

const { hierarchy: today } = zoneFixture();
const history = historyOf(STORY);
const lives = buildLives(history);

/** Today's files that the story knows plus its two ghosts, expanded so every file is a card. */
function setup() {
  const { paths } = ghostPaths(today, lives);
  const h = withGhosts(today, paths);
  const view = computeMapView(h, [], [], { showLockfiles: false, zones: { mode: 'packages', expansion: { [`${PROJECT_NODE_ID}|package:packages/server`]: true } } });
  const nodes = buildCutNodes(h, view);
  return { h, view, nodes, items: buildItemMap(view.cut!, h), paths };
}

const frameAt = (s: ReturnType<typeof setup>, index: number, prev = index, compareFrom: number | null = null, edges: Map<string, number> | null = null) =>
  buildFrame({ lives, items: s.items, index, prev, compareFrom, reduced: false, edges, commits: history.commits.length });
const byId = (nodes: Node[], id: string) => nodes.find((n) => n.id === id)!;
const cls = (n: Node) => n.className ?? '';

describe('ghost cards in the hierarchy', () => {
  it('finds exactly the deleted files that today\'s hierarchy lacks', () => {
    expect(ghostPaths(today, lives).paths.sort()).toEqual(['gone/x.ts', 'packages/server/legacy/old.ts']);
  });
  it('puts a ghost below the deepest folder or package that still exists on its path', () => {
    const h = withGhosts(today, ['packages/server/legacy/old.ts']);
    const node = h.nodes.get('file:packages/server/legacy/old.ts')!;
    expect(node).toMatchObject({ kind: 'file', name: 'old.ts', role: 'source', parentId: 'package:packages/server' });
    expect(h.nodes.get('package:packages/server')!.childIds).toContain(node.id);
    expect(h.byFile.get('packages/server/legacy/old.ts')).toBe(node.id);
  });
  it('gathers files of a folder that is gone in a "Deleted" folder at the root, and never touches the original', () => {
    const before = today.nodes.get(PROJECT_NODE_ID)!.childIds.length;
    const h = withGhosts(today, ['gone/x.ts']);
    const node = h.nodes.get('file:gone/x.ts')!;
    expect(node.parentId).toBe(`folder:${DELETED_DIR}`);
    expect(h.nodes.get(`folder:${DELETED_DIR}`)).toMatchObject({ name: 'Deleted', parentId: PROJECT_NODE_ID });
    expect(today.nodes.get(PROJECT_NODE_ID)!.childIds.length).toBe(before);
    expect(today.nodes.has('file:gone/x.ts')).toBe(false);
  });
  it('returns the same hierarchy when there is nothing to add, and caps the ghosts (most-touched first)', () => {
    expect(withGhosts(today, [])).toBe(today);
    const many = historyOf([Array.from({ length: GHOST_CAP + 20 }, (_, i) => ['A', `old/f${i}.ts`] as [string, string]), Array.from({ length: GHOST_CAP + 20 }, (_, i) => ['D', `old/f${i}.ts`] as [string, string])] as never);
    const r = ghostPaths(today, buildLives(many));
    expect(r.paths).toHaveLength(GHOST_CAP);
    expect(r.dropped).toBe(20);
  });
});

describe('what the cut stands for', () => {
  const s = setup();
  it('maps zones to the files below them, files to themselves, and every file to its top-level item', () => {
    const server = s.items.files.get('package:packages/server')!;
    expect(server).toContain('packages/server/src/a.ts');
    expect(server).toContain('packages/server/legacy/old.ts'); // the ghost sits in its zone
    expect(s.items.pathOfItem.get('file:packages/server/src/a.ts')).toBe('packages/server/src/a.ts');
    expect(s.items.topOf.get('packages/server/src/a.ts')).toBe('package:packages/server');
    expect(s.items.topOf.get('gone/x.ts')).toBeDefined();
    expect(chainOf(s.items, 'file:packages/server/src/a.ts')).toEqual(['file:packages/server/src/a.ts', 'package:packages/server']);
  });
});

describe('time travel decoration', () => {
  const s = setup();
  const deco = (index: number, prev?: number, compareFrom: number | null = null) => {
    const f = frameAt(s, index, prev, compareFrom);
    const visible = new Set<string>();
    return { nodes: decorateNodes(s.nodes, f, visible), visible, f };
  };

  it('hides files that do not exist yet and zones that are empty at that commit', () => {
    const { nodes } = deco(0);
    expect(cls(byId(nodes, 'file:packages/server/src/b.ts'))).toContain('fl-tl-absent');
    expect(cls(byId(nodes, 'file:packages/core/src/ids.ts'))).not.toContain('fl-tl-absent');
    expect(cls(byId(nodes, 'package:packages/core'))).not.toContain('fl-tl-absent');
    const web = nodes.find((n) => (n.data as ZoneNodeData).label === '@h/web')!;
    expect(cls(web)).toContain('fl-tl-absent'); // no web file before commit 2
  });

  it('shows the file count of each zone at that commit, and the change since the previous step', () => {
    const at1 = deco(1, 0).nodes;
    const core = byId(at1, 'package:packages/core').data as ZoneNodeData;
    expect(core.fileCount).toBe(2);
    expect(core.timeline).toMatchObject({ count: 2, delta: 0 });
    const server = byId(at1, 'package:packages/server').data as ZoneNodeData;
    expect(server.timeline).toMatchObject({ count: 2, delta: 1 }); // b.ts joined older.ts (as a.ts)
    const back = deco(0, 1).nodes;
    expect((byId(back, 'package:packages/server').data as ZoneNodeData).timeline!.delta).toBe(-1);
  });

  it('pops new files in, pulses modified ones and tints recent changes', () => {
    const at1 = deco(1, 0).nodes;
    expect(cls(byId(at1, 'file:packages/server/src/b.ts'))).toMatch(/fl-tl-in-[ab]/);
    expect(cls(byId(at1, 'file:packages/core/src/ids.ts'))).toMatch(/fl-tl-pulse-[ab]/);
    expect(byId(at1, 'file:packages/core/src/ids.ts').style).toMatchObject({ '--fl-tl-heat': '1.00' });
    expect(cls(byId(at1, 'file:packages/core/src/index.ts'))).toContain('fl-tl-heat'); // added in the commit before: still warm
    const calm = deco(1, 1).nodes;
    expect(cls(byId(calm, 'file:packages/core/src/ids.ts'))).not.toMatch(/fl-tl-(in|pulse)/);
  });

  it('shows a deleted file as a ghost inside its zone, then lets it go; deleted-only files too', () => {
    const del = deco(4, 3).nodes;
    expect(cls(byId(del, 'file:packages/server/legacy/old.ts'))).toContain('fl-tl-ghost');
    expect(cls(byId(del, 'file:packages/server/legacy/old.ts'))).not.toContain('absent');
    expect(cls(byId(deco(2, 1).nodes, 'file:packages/server/legacy/old.ts'))).not.toMatch(/ghost|absent/); // alive in 2..3
    expect(cls(byId(deco(7, 6).nodes, 'file:packages/server/legacy/old.ts'))).toContain('fl-tl-absent');
    expect(cls(byId(deco(5, 4).nodes, 'file:gone/x.ts'))).toContain('fl-tl-ghost');
  });

  it('a re-added file enters again', () => {
    expect(cls(byId(deco(7, 6).nodes, 'file:docs/tool.ts'))).toMatch(/fl-tl-in-/);
    expect(cls(byId(deco(6, 5).nodes, 'file:docs/tool.ts'))).toContain('fl-tl-ghost');
  });

  it('does not animate with reduced motion', () => {
    const f = buildFrame({ lives, items: s.items, index: 1, prev: 0, compareFrom: null, reduced: true, edges: null, commits: history.commits.length });
    const nodes = decorateNodes(s.nodes, f, new Set());
    expect(nodes.map(cls).join(' ')).not.toMatch(/fl-tl-(in|pulse)-/);
  });

  it('never changes a position or a size: only classes, data and style variables', () => {
    for (let i = 0; i < history.commits.length; i++) {
      const out = decorateNodes(s.nodes, frameAt(s, i, Math.max(0, i - 1)), new Set());
      out.forEach((n, k) => {
        expect(n.position).toBe(s.nodes[k].position);
        expect(n.width).toBe(s.nodes[k].width);
        expect(n.parentId).toBe(s.nodes[k].parentId);
      });
    }
  });

  it('the visible file cards at a commit are exactly the files alive then', () => {
    for (let i = 0; i < history.commits.length; i++) {
      const { nodes } = deco(i, i);
      const shown = nodes.filter((n) => n.type === 'file' && !cls(n).includes('absent') && !cls(n).includes('ghost')).map((n) => (n.data as FileNodeData).filePath).sort();
      expect(shown, `commit ${i}`).toEqual([...frameAt(s, i).states].filter(([, st]) => st.phase === 'live').map(([p]) => p).sort());
    }
  });

  it('reuses the node object when nothing about it changed (React Flow then skips it)', () => {
    const a = decorateNodes(s.nodes, frameAt(s, 3, 3), new Set());
    const b = decorateNodes(s.nodes, frameAt(s, 3, 3), new Set());
    expect(b.every((n, i) => n === a[i])).toBe(true);
  });

  it('compare: added, changed and removed files are marked; removed ones stay as red ghosts', () => {
    const { nodes, f } = deco(7, 7, 1);
    expect(f.compare!.removed.has('gone/x.ts')).toBe(true);
    expect(cls(byId(nodes, 'file:docs/tool.ts'))).toContain('fl-tl-cmp-added');
    expect(cls(byId(nodes, 'file:packages/server/src/a.ts'))).toContain('fl-tl-cmp-changed');
    expect(cls(byId(nodes, 'file:packages/core/src/index.ts'))).toContain('fl-tl-cmp-same');
    expect(cls(byId(nodes, 'file:gone/x.ts'))).toContain('fl-tl-cmp-removed');
    const z = byId(nodes, 'package:packages/core').data as ZoneNodeData;
    expect(z.timeline!.delta).toBe(0);
  });
});

describe('edges while time travelling', () => {
  const s = setup();
  const edge = (source: string, target: string, count = 5): Edge<CanvasEdgeData> =>
    ({ id: `e:${source}>${target}`, source, target, data: { kind: 'aggregated-edge', types: ['import'], dominantType: 'import', count, label: `imports ${count}` } as CanvasEdgeData });

  it('hides every edge without link history', () => {
    const f = frameAt(s, 3);
    const visible = new Set<string>();
    decorateNodes(s.nodes, f, visible);
    expect(decorateEdges([edge('package:packages/server', 'package:packages/core')], f, visible).every((e) => e.hidden)).toBe(true);
  });

  it('with link history shows only the edges alive at the sample, re-counted', () => {
    const w = new Map([['package:packages/server>package:packages/core', 2]]);
    const f = frameAt(s, 3, 3, null, w);
    const visible = new Set<string>();
    decorateNodes(s.nodes, f, visible);
    const live = edge('package:packages/server', 'package:packages/core');
    const dead = edge('package:packages/core', 'package:packages/server');
    const [a, b] = decorateEdges([live, dead], f, visible);
    expect(a.hidden).toBe(false);
    expect(a.data).toMatchObject({ count: 2, label: '2 links' });
    expect(b.hidden).toBe(true);
    expect(decorateEdges([live], f, visible)[0]).toBe(a); // cached
  });

  it('drops an edge whose end is not on the map at that commit', () => {
    const w = new Map([['package:packages/server>package:packages/core', 2]]);
    const f = frameAt(s, 3, 3, null, w);
    const visible = new Set<string>();
    decorateNodes(s.nodes, f, visible);
    visible.delete('package:packages/core');
    expect(decorateEdges([edge('package:packages/server', 'package:packages/core')], f, visible)[0].hidden).toBe(true);
  });
});
