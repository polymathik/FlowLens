import { describe, it, expect } from 'vitest';
import { computeMapView } from '../../../src/canvas/utils/map-view';
import { computeFocusView, normalizeFocus } from '../../../src/canvas/focus/focus-view';
import { fileOfNode } from '../../../src/canvas/focus/focus-index';
import { FOCUS_MORE_PREFIX, FOCUS_SELF_ZONE_ID, type MapView, type MapViewOptions } from '../../../src/contracts/canvas/index.js';
import { resolveRef } from '../../../src/analysis/hierarchy/index.js';
import type { RelationType } from '../../../src/contracts/relations.js';
import { F, rel, S, zoneFixture } from '../helpers/zone-fixture';

const fx = zoneFixture();
const { hierarchy: h } = fx;
const N = (path: string) => `file:${path}`;
const ADAPTER = 'packages/core/src/adapter.ts';
const CODEX = 'packages/server/src/adapters/codex/codex.ts';
const ALL: RelationType[] = ['import', 'call', 'extend', 'implement', 'use', 'create'];
const opts = (mode: 'packages' | 'folders' = 'packages'): MapViewOptions => ({ showLockfiles: false, zones: { mode, expansion: {} } });
const focus = (id: string, request = {}, mode: 'packages' | 'folders' = 'packages', relations = fx.relations): MapView => computeFocusView(h, relations, id, request, opts(mode));
const names = (v: MapView) => v.focus!.shown === 0 ? [] : Object.keys(v.focus!.distance).filter((f) => v.focus!.distance[f] > 0).map((f) => h.nodes.get(f)!.path).sort();

describe('focus view: depth, direction and types', () => {
  it('depth 1 shows direct consumers, depth 2 their consumers, depth 3 adds nothing more here', () => {
    const d1 = focus(F(ADAPTER), { depth: 1, direction: 'in' });
    expect(names(d1)).toEqual(['packages/server/src/a.ts', 'packages/server/src/adapters/codex/codex.ts', 'packages/server/src/b.ts']);
    const d2 = focus(F(ADAPTER), { depth: 2, direction: 'in' });
    expect(names(d2)).toEqual([...names(d1), 'packages/server/src/cli.ts', 'packages/server/test/a.test.ts'].sort());
    expect(names(focus(F(ADAPTER), { depth: 3, direction: 'in' }))).toEqual(names(d2));
    expect(d2.focus!.distance[N('packages/server/src/cli.ts')]).toBe(2);
  });

  it('direction out follows what the focus uses; both is the union', () => {
    expect(names(focus(F(CODEX), { depth: 1, direction: 'out' }))).toEqual([ADAPTER, 'packages/server/src/adapters/codex/parse.ts', 'packages/server/src/adapters/cursor.ts']);
    expect(names(focus(F(CODEX), { depth: 1, direction: 'in' }))).toEqual(['packages/server/src/cli.ts']);
    expect(names(focus(F(CODEX), { depth: 1, direction: 'both' }))).toEqual([ADAPTER, 'packages/server/src/adapters/codex/parse.ts', 'packages/server/src/adapters/cursor.ts', 'packages/server/src/cli.ts'].sort());
  });

  it('only the selected relation types are followed; the others are counted, not drawn', () => {
    const v = focus(F(CODEX), { depth: 1, direction: 'out', types: ['call'] });
    expect(names(v)).toEqual([ADAPTER]);
    expect(v.focus!.accounting.excludedByType).toBeGreaterThan(0);
    expect(v.accounting.considered + v.focus!.accounting.lateral).toBe(v.focus!.accounting.touching);
  });

  it('normalizes the request: depth is 1..3, defaults are both directions and the structural types', () => {
    expect(normalizeFocus({ depth: 9 }).depth).toBe(3);
    expect(normalizeFocus({ depth: 0 }).depth).toBe(1);
    expect(normalizeFocus()).toMatchObject({ depth: 2, direction: 'both', types: ['import', 'call', 'extend', 'implement'] });
  });
});

describe('focus view: cards, zones and the cap', () => {
  it('draws the focus and its neighbours as cards inside the zones of the current grouping', () => {
    const v = focus(F(ADAPTER), { depth: 2, direction: 'in' });
    const cut = v.cut!;
    expect(v.focus!.kind).toBe('file');
    expect(v.containerId).toBe('project');
    for (const f of [N(ADAPTER), ...Object.keys(v.focus!.distance)]) expect(cut.atomOfFile[f]).toBe(f);
    expect(cut.totalFiles).toBe(Object.keys(v.focus!.distance).length);
    const frames = cut.items.filter((i) => i.kind === 'zone' && i.expanded).map((i) => i.label).sort();
    expect(frames).toEqual(['@h/core', '@h/server']);
    expect(v.bundles).toEqual([]);
    expect(v.portals).toEqual([]);
  });

  it('follows Group-by: the same focus grouped by folders', () => {
    const v = focus(F(ADAPTER), { depth: 1, direction: 'in' }, 'folders');
    expect(v.zoning!.mode).toBe('folders');
    expect(v.cut!.atomOfFile[N(ADAPTER)]).toBe(N(ADAPTER));
    expect(v.cut!.items.some((i) => i.kind === 'zone' && i.expanded)).toBe(true);
  });

  it('folds neighbours past the cap into one "+N more" card per zone, and says so', () => {
    const v = focus(F(ADAPTER), { depth: 3, direction: 'in', cap: 3 });
    const f = v.focus!;
    expect(f.shown + 1).toBe(3);
    expect(f.folded).toBeGreaterThan(0);
    expect(f.notice).toMatch(/nearest/);
    const more = v.cut!.items.filter((i) => i.id.startsWith(FOCUS_MORE_PREFIX));
    expect(more.length).toBeGreaterThan(0);
    expect(more.reduce((n, i) => n + i.fileCount, 0)).toBe(f.folded);
    expect(more.every((i) => !i.expanded && i.label.startsWith('+'))).toBe(true);
    // nearest first: every shown neighbour is at least as close as every folded one
    const shown = Object.entries(f.distance).filter(([id]) => v.cut!.atomOfFile[id] === id && id !== N(ADAPTER)).map(([, d]) => d);
    const folded = Object.entries(f.distance).filter(([id]) => v.cut!.atomOfFile[id] !== id).map(([, d]) => d);
    expect(Math.max(...shown)).toBeLessThanOrEqual(Math.min(...folded));
  });

  it('is deterministic', () => {
    const a = focus(F(ADAPTER), { depth: 3, direction: 'both', cap: 4 });
    const b = focus(F(ADAPTER), { depth: 3, direction: 'both', cap: 4 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('focus view: exact accounting', () => {
  /** Independent count: every non-contain relation with an end in a file of the neighbourhood. */
  function brute(v: MapView): number {
    const set = new Set(Object.keys(v.focus!.distance));
    return fx.relations.filter((r) => {
      if (r.type === 'contain' || !r.to) return false;
      const a = resolveRef(h, r.from);
      const b = resolveRef(h, r.to);
      return !!a && !!b && (set.has(fileOfNode(h, a) ?? '') || set.has(fileOfNode(h, b) ?? ''));
    }).length;
  }

  it.each([
    ['file in', F(ADAPTER), { depth: 1, direction: 'in' as const }],
    ['file both depth 2', F(CODEX), { depth: 2, direction: 'both' as const }],
    ['capped', F(ADAPTER), { depth: 3, direction: 'both' as const, cap: 2 }],
    ['one type', F(CODEX), { depth: 3, direction: 'both' as const, types: ['call'] as RelationType[] }],
    ['all types', F(CODEX), { depth: 2, direction: 'both' as const, types: ALL }],
  ])('%s: considered = edges + internal + hidden, and nothing touching is lost', (_name, id, req) => {
    const v = focus(id, req);
    const a = v.accounting;
    expect(a.considered).toBe(a.edges + a.portalIn + a.portalOut + a.internal + a.hidden);
    expect(a.portalIn + a.portalOut).toBe(0);
    expect(v.focus!.accounting.touching).toBe(a.considered + v.focus!.accounting.lateral);
    expect(v.focus!.accounting.touching + v.focus!.accounting.excludedByType).toBe(brute(v));
    const linkSum = v.links.reduce((n, l) => n + l.count, 0);
    expect(linkSum).toBe(a.edges);
  });

  it('relations leaving the neighbourhood are counted as hidden and hinted on the card', () => {
    const v = focus(F(CODEX), { depth: 1, direction: 'out' });
    expect(v.accounting.hidden).toBeGreaterThan(0); // cli.ts (a consumer) and others are outside
    expect(v.focus!.beyond[N(CODEX)]).toBeGreaterThan(0);
  });

  it('links between neighbours that are not one step further out are counted, and drawn only on request', () => {
    const extra = [...fx.relations, rel(F('packages/server/src/adapters/codex/parse.ts'), F('packages/server/src/adapters/cursor.ts'))];
    const quiet = focus(F(CODEX), { depth: 1, direction: 'out' }, 'packages', extra);
    expect(quiet.focus!.accounting.lateral).toBe(1);
    expect(quiet.links.some((l) => l.source.endsWith('parse.ts') && l.target.endsWith('cursor.ts'))).toBe(false);
    const all = focus(F(CODEX), { depth: 1, direction: 'out', lateral: true }, 'packages', extra);
    expect(all.focus!.accounting.lateral).toBe(0);
    expect(all.links.some((l) => l.source.endsWith('parse.ts') && l.target.endsWith('cursor.ts'))).toBe(true);
    expect(all.accounting.considered).toBe(quiet.accounting.considered + 1);
    expect(all.focus!.accounting.touching).toBe(quiet.focus!.accounting.touching);
  });

  it('a relation of an unselected type that touches the focus is counted in excludedByType', () => {
    const extra = [...fx.relations, rel(F(CODEX), F('packages/core/src/ids.ts'), 'use')];
    const v = focus(F(CODEX), { depth: 1, direction: 'out' }, 'packages', extra);
    expect(v.focus!.accounting.excludedByType).toBe(1);
  });
});

describe('focus view: symbols and containers', () => {
  it('a symbol focus follows symbol relations, not everything its file touches; its file is the card', () => {
    const SYM = S('apps/web/src/app.ts', 'main');
    const v = focus(SYM, { depth: 1, direction: 'out' });
    expect(v.focus!.kind).toBe('symbol');
    expect(v.focus!.focusFiles).toEqual([N('apps/web/src/app.ts')]);
    expect(names(v)).toEqual(['apps/web/src/ui/card.ts']); // the file also imports button.ts and core/index.ts: not this symbol
    expect(v.focus!.symbolIds[0]).toBe(SYM);
    expect(v.focus!.symbolIds).toContain(S('apps/web/src/ui/card.ts', 'main'));
  });

  it('a package focus is ONE card; its external neighbourhood is drawn around it', () => {
    const v = focus('package:packages/core', { depth: 1, direction: 'in' });
    const f = v.focus!;
    expect(f.kind).toBe('container');
    expect(f.focusFiles.length).toBe(3);
    for (const file of f.focusFiles) expect(v.cut!.atomOfFile[file]).toBe(FOCUS_SELF_ZONE_ID);
    const self = v.cut!.items.find((i) => i.id === FOCUS_SELF_ZONE_ID)!;
    expect(self).toMatchObject({ expanded: false, fileCount: 3, label: '@h/core' });
    expect(names(v)).toEqual(['apps/web/src/app.ts', 'docs/tool.ts', 'packages/server/src/a.ts', 'packages/server/src/adapters/claude/claude.ts', 'packages/server/src/adapters/codex/codex.ts', 'packages/server/src/b.ts'].sort());
    expect(v.accounting.internal).toBe(1); // a.ts calls its own helper: inside one card
    expect(v.accounting.considered).toBe(v.accounting.edges + v.accounting.internal + v.accounting.hidden);
  });

  it('a zone focus works through the zone id', () => {
    const zoneId = computeMapView(h, fx.relations, [], opts()).zoning!.zoneSet.zones.find((z) => z.label === '@h/core')!.id;
    const v = focus(zoneId, { depth: 1, direction: 'in' });
    expect(v.focus!.kind).toBe('container');
    expect(v.focus!.focusFiles.length).toBe(3);
    expect(v.cut!.atomOfFile[N(ADAPTER)]).toBe(FOCUS_SELF_ZONE_ID);
  });

  it('an unknown id falls back to the normal view without focus info', () => {
    const v = focus('file:nope.ts');
    expect(v.focus).toBeUndefined();
    expect(v.cut!.totalFiles).toBeGreaterThan(10);
  });

  it('computeMapView routes to the focus view when options.focus is set, and ignores the drill path', () => {
    const v = computeMapView(h, fx.relations, ['package:packages/server'], { showLockfiles: false, zones: { mode: 'packages', expansion: {} }, focus: { id: F(ADAPTER), depth: 1, direction: 'in' } });
    expect(v.focus?.kind).toBe('file');
    expect(v.containerId).toBe('project');
  });
});
