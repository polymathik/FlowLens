import { describe, it, expect } from 'vitest';
import { parseArchitectureConfig } from '../../../src/canvas/api/architecture-schema.js';
import {
  addLayer,
  normalizeConfig,
  removeLayer,
  renameLayer,
  setRestricted,
  toggleAccess,
} from '../../../src/canvas/utils/architecture-draft.js';
import type { ArchitectureConfig } from '../../../src/contracts/architecture.js';

const base: ArchitectureConfig = normalizeConfig({
  layers: [
    { name: 'ui', include: { patterns: ['src/ui/**'] } },
    { name: 'api', include: { patterns: ['src/{api,routes}/**'] }, must_not_access: ['ui'] },
  ],
});

describe('parseArchitectureConfig (server-side zod validation)', () => {
  it('accepts a valid config and fills metadata', () => {
    const r = parseArchitectureConfig({ layers: base.layers });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config).toMatchObject({ version: 2, inferred_by: 'manual', layers: base.layers });
  });

  it('rejects unknown references, duplicates, self references and empty patterns', () => {
    const r = parseArchitectureConfig({
      layers: [
        { name: 'ui', include: { patterns: [''] }, may_only_access: ['ui'] },
        { name: 'ui', include: { patterns: [] }, must_not_access: ['nope'] },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.issues.map((i) => i.path);
      expect(paths).toContain('layers.0.include.patterns.0');
      expect(paths).toContain('layers.1.name');
      expect(paths).toContain('layers.1.must_not_access.0');
      expect(paths).toContain('layers.0.may_only_access.0');
    }
  });

  it('rejects non-objects', () => {
    expect(parseArchitectureConfig('nope').ok).toBe(false);
    expect(parseArchitectureConfig({ layers: 'x' }).ok).toBe(false);
  });
});

describe('architecture draft helpers', () => {
  it('keeps commas inside patterns (brace globs)', () => {
    expect(base.layers[1].include.patterns).toEqual(['src/{api,routes}/**']);
  });

  it('rename updates references; remove drops them', () => {
    const renamed = renameLayer(base, 0, 'web');
    expect(renamed.layers[1].must_not_access).toEqual(['web']);
    const removed = removeLayer(renamed, 0);
    expect(removed.layers).toHaveLength(1);
    expect(removed.layers[0].must_not_access).toBeUndefined();
  });

  it('toggles must_not_access and the may_only_access restriction', () => {
    const t = toggleAccess(base, 1, 'must_not_access', 'ui');
    expect(t.layers[1].must_not_access).toBeUndefined();
    const restricted = setRestricted(base, 0, true);
    expect(restricted.layers[0].may_only_access).toEqual([]);
    expect(toggleAccess(restricted, 0, 'may_only_access', 'api').layers[0].may_only_access).toEqual(['api']);
    expect(setRestricted(restricted, 0, false).layers[0].may_only_access).toBeUndefined();
  });

  it('addLayer picks a unique name and the result validates', () => {
    const next = addLayer(addLayer(base));
    expect(next.layers.map((l) => l.name)).toEqual(['ui', 'api', 'new-layer', 'new-layer-2']);
    expect(parseArchitectureConfig(next).ok).toBe(true);
  });
});
