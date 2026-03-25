import { describe, it, expect } from 'vitest';
import { inferArchitecture } from '../../../src/architecture/heuristic-inference.js';
import type { Entity } from '../../../src/contracts/entities.js';
import type { Relation } from '../../../src/contracts/relations.js';

function makeFileEntity(id: string, file: string): Entity {
  return {
    id, kind: 'file', name: file.split('/').pop()!, qualified_name: file, file,
    location: { line_start: 1, line_end: 10, column_start: 0, column_end: 0 },
    visibility: 'public', language: 'typescript',
  };
}

function makeImport(id: string, from: string, to: string): Relation {
  return {
    id, from, to, type: 'import',
    location: { file: 'test.ts', line: 1, column: 0 },
    weight: 1, confidence: 1.0,
  };
}

describe('inferArchitecture', () => {
  it('groups files by directory prefix into layers', () => {
    const entities = [
      makeFileEntity('1', 'routes/users.ts'),
      makeFileEntity('2', 'routes/auth.ts'),
      makeFileEntity('3', 'services/user-service.ts'),
    ];
    const relations = [makeImport('r1', '1', '3')];

    const config = inferArchitecture(entities, relations);
    expect(config.version).toBe(2);
    expect(config.inferred_by).toBe('heuristic');
    expect(config.layers.length).toBeGreaterThanOrEqual(2);

    const routesLayer = config.layers.find(l => l.name === 'Routes');
    expect(routesLayer).toBeDefined();
    expect(routesLayer!.include.patterns).toContain('routes/**');

    const servicesLayer = config.layers.find(l => l.name === 'Services');
    expect(servicesLayer).toBeDefined();
  });

  it('sets may_only_access based on imports', () => {
    const entities = [
      makeFileEntity('1', 'routes/users.ts'),
      makeFileEntity('2', 'services/user-service.ts'),
    ];
    const relations = [makeImport('r1', '1', '2')];

    const config = inferArchitecture(entities, relations);
    const routesLayer = config.layers.find(l => l.name === 'Routes');
    expect(routesLayer?.may_only_access).toContain('Services');
  });

  it('falls back to single Application layer for flat projects', () => {
    const entities = [
      makeFileEntity('1', 'app.ts'),
      makeFileEntity('2', 'index.ts'),
    ];
    const config = inferArchitecture(entities, []);
    expect(config.layers).toHaveLength(1);
    expect(config.layers[0].name).toBe('Application');
  });

  it('handles empty input', () => {
    const config = inferArchitecture([], []);
    expect(config.layers).toHaveLength(1);
    expect(config.layers[0].name).toBe('Application');
  });

  it('ignores non-file entities', () => {
    const entities: Entity[] = [
      makeFileEntity('1', 'routes/users.ts'),
      { ...makeFileEntity('2', 'services/svc.ts'), kind: 'class', name: 'Svc' },
    ];
    const config = inferArchitecture(entities, []);
    // Only file entities should be considered for grouping
    const routesLayer = config.layers.find(l => l.name === 'Routes');
    expect(routesLayer).toBeDefined();
  });
});
