import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveEntity, isResolveError } from '../../../src/mcp/entity-resolver.js';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeEntity(id: string, name: string, qn: string, file: string, kind = 'class' as const) {
  return {
    id,
    kind,
    name,
    qualified_name: qn,
    file,
    location: { line_start: 1, line_end: 10, column_start: 0, column_end: 0 },
    visibility: 'public' as const,
    language: 'typescript',
  };
}

describe('EntityResolver', () => {
  let store: LevelGraphStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-er-'));
    store = new LevelGraphStore();
    await store.open(join(tmpDir, 'graph'));
    await store.putNodes([
      makeEntity('abc123', 'UserService', 'src/user-service.ts/UserService', 'src/user-service.ts'),
      makeEntity('def456', 'AuthService', 'src/auth-service.ts/AuthService', 'src/auth-service.ts'),
      makeEntity('file1', 'user-service.ts', 'src/user-service.ts', 'src/user-service.ts', 'file'),
    ]);
  });

  afterEach(async () => {
    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('resolves by exact ID', async () => {
    const r = await resolveEntity(store, 'abc123');
    expect(isResolveError(r)).toBe(false);
    if (!isResolveError(r)) expect(r.entity.name).toBe('UserService');
  });

  it('resolves by qualified_name', async () => {
    const r = await resolveEntity(store, 'src/user-service.ts/UserService');
    expect(isResolveError(r)).toBe(false);
  });

  it('resolves by file path', async () => {
    const r = await resolveEntity(store, 'src/user-service.ts');
    expect(isResolveError(r)).toBe(false);
    if (!isResolveError(r)) expect(r.entity.kind).toBe('file');
  });

  it('resolves unique partial name', async () => {
    const r = await resolveEntity(store, 'UserService');
    expect(isResolveError(r)).toBe(false);
  });

  it('returns error with suggestions for ambiguous partial', async () => {
    const r = await resolveEntity(store, 'Service');
    expect(isResolveError(r)).toBe(true);
    if (isResolveError(r)) {
      expect(r.error).toContain('Ambiguous');
      expect(r.suggestions.length).toBeGreaterThan(0);
    }
  });

  it('returns error for not found', async () => {
    const r = await resolveEntity(store, 'NonExistent');
    expect(isResolveError(r)).toBe(true);
    if (isResolveError(r)) expect(r.error).toContain('not found');
  });
});
