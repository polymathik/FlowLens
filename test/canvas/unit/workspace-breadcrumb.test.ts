import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeWorkspace, manifestName, workspaceGlobsOf } from '../../../src/canvas/api/workspace.js';
import { selectPackages } from '../../../src/analysis/hierarchy/index.js';
import { crumbsFor, layoutCrumbs } from '../../../src/canvas/utils/breadcrumb.js';
import { editorUrl } from '../../../src/canvas/utils/editor-link.js';
import { manifestsFromEntities } from '../../../src/canvas/hooks/useGraphData.js';
import { buildExplorerHash, parseExplorerHash } from '../../../src/canvas/router/explorer-route.js';
import { sampleHierarchy, entity } from '../helpers/factories.js';
import type { GraphStore } from '../../../src/contracts/graph.js';

describe('GET /workspace data', () => {
  it('reads globs and manifest names from the project root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fl-ws-'));
    try {
      await mkdir(join(root, 'packages/core'), { recursive: true });
      await mkdir(join(root, 'apps/web'), { recursive: true });
      await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'halcyon' }));
      await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n  - "packages/*"\n');
      await writeFile(join(root, 'packages/core/package.json'), JSON.stringify({ name: '@halcyon/core' }));
      await writeFile(join(root, 'apps/web/package.json'), '{ not json');
      const graph = { getNodesByKind: async () => ['package.json', 'packages/core/package.json', 'apps/web/package.json', 'src/a.ts'].map((f) => ({ file: f })) } as unknown as GraphStore;
      const ws = await computeWorkspace(graph, root);
      expect(ws.project_name).toBe('halcyon');
      expect(ws.workspace_globs).toEqual(['apps/*', 'packages/*']);
      expect(ws.manifests.map((m) => [m.dir, m.name])).toEqual([['apps/web', ''], ['', 'halcyon'], ['packages/core', '@halcyon/core']]);
      // an unparsable manifest still yields a package, named after its directory
      expect(selectPackages(ws.manifests, ws.workspace_globs).map((p) => [p.dir, p.name])).toEqual([['apps/web', 'web'], ['packages/core', '@halcyon/core']]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('parses names of other manifests and package.json workspaces', () => {
    expect(manifestName('pyproject.toml', '[project]\nname = "svc"\n')).toBe('svc');
    expect(manifestName('go.mod', 'module example.com/x\n\ngo 1.22')).toBe('example.com/x');
    expect(workspaceGlobsOf(null, JSON.stringify({ workspaces: ['pkgs/*'] }))).toEqual(['pkgs/*']);
    expect(workspaceGlobsOf(null, JSON.stringify({ workspaces: { packages: ['w/*'] } }))).toEqual(['w/*']);
    expect(workspaceGlobsOf(null, 'garbage')).toEqual([]);
  });

  it('falls back to manifests found in the entity list', () => {
    const files = [entity('1', 'packages/a/package.json', 'file'), entity('2', 'package.json', 'file'), entity('3', 'src/x.ts', 'file')];
    expect(manifestsFromEntities(files).map((m) => m.dir)).toEqual(['packages/a', '']);
  });
});

describe('breadcrumb', () => {
  const { hierarchy } = sampleHierarchy();

  it('shows the full clickable path from the project root', () => {
    const crumbs = crumbsFor(hierarchy, ['folder:src', 'folder:src/core', 'file:src/core/store.ts', 'Store']);
    expect(crumbs.map((c) => c.label)).toEqual(['Sample', 'src', 'core', 'store.ts', 'Store']);
    expect(crumbs.map((c) => c.level)).toEqual([-1, 0, 1, 2, 3]);
    expect(crumbs[3].title).toBe('src/core/store.ts');
    expect(crumbsFor(hierarchy, []).map((c) => c.label)).toEqual(['Sample']);
  });

  it('drops stale entries after a re-index', () => {
    expect(crumbsFor(hierarchy, ['folder:src', 'folder:gone']).map((c) => c.label)).toEqual(['Sample', 'src']);
  });

  it('folds the middle into a menu only when the path is too long, keeping root and last crumbs', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `segment-${i}`, title: '', level: i - 1 }));
    expect(layoutCrumbs(mk(4))).toEqual({ head: mk(4), hidden: [], tail: [] });
    const long = layoutCrumbs(mk(14));
    expect(long.head.map((c) => c.id)).toEqual(['n0']);
    expect(long.tail.length).toBeGreaterThanOrEqual(2);
    expect(long.tail[long.tail.length - 1].id).toBe('n13');
    expect([...long.head, ...long.hidden, ...long.tail].map((c) => c.id)).toEqual(mk(14).map((c) => c.id)); // nothing lost
  });
});

describe('editor links', () => {
  it('builds vscode:// and cursor:// links with line and column', () => {
    expect(editorUrl('vscode', '/Users/me/proj', 'src/a.ts', 12, 4)).toBe('vscode://file/Users/me/proj/src/a.ts:12:5');
    expect(editorUrl('cursor', '/Users/me/my proj/', 'src/a b.ts', 3)).toBe('cursor://file/Users/me/my%20proj/src/a%20b.ts:3');
    expect(editorUrl('vscode', 'C:\\Users\\me\\proj', 'src\\a.ts', 1, 0)).toBe('vscode://file/C:/Users/me/proj/src/a.ts:1:1');
    expect(editorUrl('vscode', '', 'src/a.ts')).toBeNull();
  });
});

describe('explorer route: path links round-trip', () => {
  it('#/p/<id>/map/path/<repo path>?overlay=…', () => {
    const route = { tab: 'project' as const, projectId: 'p1', view: 'map' as const, target: { kind: 'path' as const, identifier: 'packages/@h/server/src' }, overlay: 'cycles' as const };
    const hash = buildExplorerHash(route);
    expect(hash).toBe('#/p/p1/map/path/packages/%40h/server/src?overlay=cycles');
    expect(parseExplorerHash(hash)).toEqual(route);
    // a path segment literally named "map" does not confuse the view detection
    const tricky = { ...route, target: { kind: 'path' as const, identifier: 'src/map/x.ts' }, overlay: undefined };
    expect(parseExplorerHash(buildExplorerHash(tricky))).toMatchObject({ view: 'map', target: { kind: 'path', identifier: 'src/map/x.ts' } });
    expect(parseExplorerHash('#/p/p1/map/path/.')).toMatchObject({ target: { kind: 'path', identifier: '.' } });
  });
});
