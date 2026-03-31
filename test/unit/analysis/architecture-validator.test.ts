import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveLayer,
  validateArchitecture,
} from '../../../src/analysis/architecture-validator.js';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import type { Entity } from '../../../src/contracts/entities.js';
import type { Relation, RelationType } from '../../../src/contracts/relations.js';
import type { ArchitectureConfig } from '../../../src/contracts/architecture.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* ---------- helpers ---------- */

function makeEntity(
  id: string,
  name: string,
  file: string,
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id,
    kind: 'class',
    name,
    qualified_name: `${file}/${name}`,
    file,
    location: { line_start: 1, line_end: 10, column_start: 0, column_end: 0 },
    visibility: 'public',
    language: 'typescript',
    ...overrides,
  };
}

function makeEdge(
  id: string,
  from: string,
  to: string,
  type: RelationType = 'import',
): Relation {
  return {
    id,
    from,
    to,
    type,
    location: { file: 'test.ts', line: 1, column: 0 },
    weight: 1,
    confidence: 1.0,
  };
}

const layeredConfig: ArchitectureConfig = {
  version: 2,
  inferred_by: 'manual',
  inferred_at: '2026-01-01T00:00:00Z',
  layers: [
    {
      name: 'Routes',
      include: { patterns: ['routes/**'] },
      may_only_access: ['Services'],
    },
    {
      name: 'Services',
      include: { patterns: ['services/**'] },
      may_only_access: ['Data'],
    },
    { name: 'Data', include: { patterns: ['data/**'] } },
  ],
};

/* ---------- test suite ---------- */

describe('ArchitectureValidator', () => {
  let store: LevelGraphStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-arch-'));
    store = new LevelGraphStore();
    await store.open(join(tmpDir, 'graph'));
  });

  afterEach(async () => {
    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('no violations for clean architecture', async () => {
    // Routes → Services → Data (all within rules)
    await store.putNodes([
      makeEntity('users-route', 'UsersRoute', 'routes/users.ts'),
      makeEntity('user-service', 'UserService', 'services/user-service.ts'),
      makeEntity('user-repo', 'UserRepo', 'data/user-repo.ts'),
    ]);
    await store.putEdges([
      makeEdge('e1', 'users-route', 'user-service'),
      makeEdge('e2', 'user-service', 'user-repo'),
    ]);

    const violations = await validateArchitecture(store, layeredConfig);
    expect(violations).toHaveLength(0);
  });

  it('detects may_only_access violation', async () => {
    // Routes → Data directly (Routes may only access Services)
    await store.putNodes([
      makeEntity('admin-route', 'AdminRoute', 'routes/admin.ts'),
      makeEntity('user-repo', 'UserRepo', 'data/user-repo.ts'),
    ]);
    await store.putEdges([
      makeEdge('e1', 'admin-route', 'user-repo'),
    ]);

    const violations = await validateArchitecture(store, layeredConfig);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('may_only_access');
    expect(violations[0].layer_from).toBe('Routes');
    expect(violations[0].layer_to).toBe('Data');
    expect(violations[0].entity_from).toBe('admin-route');
    expect(violations[0].entity_to).toBe('user-repo');
  });

  it('detects must_not_access violation', async () => {
    const configWithMustNot: ArchitectureConfig = {
      version: 2,
      inferred_by: 'manual',
      inferred_at: '2026-01-01T00:00:00Z',
      layers: [
        {
          name: 'Routes',
          include: { patterns: ['routes/**'] },
          must_not_access: ['Data'],
        },
        { name: 'Services', include: { patterns: ['services/**'] } },
        { name: 'Data', include: { patterns: ['data/**'] } },
      ],
    };

    await store.putNodes([
      makeEntity('admin-route', 'AdminRoute', 'routes/admin.ts'),
      makeEntity('user-repo', 'UserRepo', 'data/user-repo.ts'),
    ]);
    await store.putEdges([
      makeEdge('e1', 'admin-route', 'user-repo'),
    ]);

    const violations = await validateArchitecture(store, configWithMustNot);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('must_not_access');
    expect(violations[0].layer_from).toBe('Routes');
    expect(violations[0].layer_to).toBe('Data');
  });

  it('resolves layers from glob patterns', () => {
    const entity = makeEntity('r1', 'FooRoute', 'routes/foo.ts');
    expect(resolveLayer(entity, layeredConfig)).toBe('Routes');

    const service = makeEntity('s1', 'FooService', 'services/foo.ts');
    expect(resolveLayer(service, layeredConfig)).toBe('Services');

    const repo = makeEntity('d1', 'FooRepo', 'data/foo.ts');
    expect(resolveLayer(repo, layeredConfig)).toBe('Data');
  });

  it('resolves layers from file lists', () => {
    const config: ArchitectureConfig = {
      version: 2,
      inferred_by: 'manual',
      inferred_at: '2026-01-01T00:00:00Z',
      layers: [
        {
          name: 'Core',
          include: { files: ['src/core/engine.ts', 'src/core/runtime.ts'] },
        },
      ],
    };

    const entity = makeEntity('e1', 'Engine', 'src/core/engine.ts');
    expect(resolveLayer(entity, config)).toBe('Core');

    const other = makeEntity('e2', 'Other', 'src/other/file.ts');
    expect(resolveLayer(other, config)).toBeNull();
  });

  it('resolves layers from entity names', () => {
    const config: ArchitectureConfig = {
      version: 2,
      inferred_by: 'manual',
      inferred_at: '2026-01-01T00:00:00Z',
      layers: [
        {
          name: 'Controllers',
          include: { entities: ['UserController', 'AdminController'] },
        },
      ],
    };

    const entity = makeEntity('c1', 'UserController', 'src/controllers/user.ts');
    expect(resolveLayer(entity, config)).toBe('Controllers');

    // Also matches qualified_name
    const byQualified = makeEntity('c2', 'other', 'src/ctrl.ts', {
      qualified_name: 'AdminController',
    });
    expect(resolveLayer(byQualified, config)).toBe('Controllers');

    const noMatch = makeEntity('c3', 'NotAController', 'src/foo.ts');
    expect(resolveLayer(noMatch, config)).toBeNull();
  });

  it('handles unassigned entities — no violation for their edges', async () => {
    // Entity in lib/ doesn't match any layer
    await store.putNodes([
      makeEntity('lib-util', 'LibUtil', 'lib/util.ts'),
      makeEntity('user-repo', 'UserRepo', 'data/user-repo.ts'),
    ]);
    await store.putEdges([
      makeEdge('e1', 'lib-util', 'user-repo'),
    ]);

    const violations = await validateArchitecture(store, layeredConfig);
    expect(violations).toHaveLength(0);
  });

  it('generates auto-fix suggestions', async () => {
    // may_only_access violation
    await store.putNodes([
      makeEntity('admin-route', 'AdminRoute', 'routes/admin.ts'),
      makeEntity('user-repo', 'UserRepo', 'data/user-repo.ts'),
    ]);
    await store.putEdges([
      makeEdge('e1', 'admin-route', 'user-repo'),
    ]);

    const violations = await validateArchitecture(store, layeredConfig);
    expect(violations).toHaveLength(1);
    expect(violations[0].auto_fix_suggestion).toBeTruthy();
    expect(violations[0].auto_fix_suggestion).toContain('Services');
    expect(violations[0].auto_fix_suggestion).toContain('Data');

    // must_not_access violation
    await store.clear();
    const configWithMustNot: ArchitectureConfig = {
      version: 2,
      inferred_by: 'manual',
      inferred_at: '2026-01-01T00:00:00Z',
      layers: [
        {
          name: 'Routes',
          include: { patterns: ['routes/**'] },
          must_not_access: ['Data'],
        },
        { name: 'Data', include: { patterns: ['data/**'] } },
      ],
    };

    await store.putNodes([
      makeEntity('admin-route', 'AdminRoute', 'routes/admin.ts'),
      makeEntity('user-repo', 'UserRepo', 'data/user-repo.ts'),
    ]);
    await store.putEdges([
      makeEdge('e1', 'admin-route', 'user-repo'),
    ]);

    const mustNotViolations = await validateArchitecture(
      store,
      configWithMustNot,
    );
    expect(mustNotViolations).toHaveLength(1);
    expect(mustNotViolations[0].auto_fix_suggestion).toBeTruthy();
    expect(mustNotViolations[0].auto_fix_suggestion).toContain(
      'common layer',
    );
  });
});
