import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureProjectIdentity, readProjectIdentity } from '../../../src/utils/project-identity.js';

describe('project identity', () => {
  it('creates once and is stable afterwards', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'fl-id-')), '.flowlens');
    expect(readProjectIdentity(dir)).toBeNull();
    const a = ensureProjectIdentity(dir, '/repo');
    const b = ensureProjectIdentity(dir, '/repo');
    expect(a.id).toMatch(/^[0-9a-f]{12}$/);
    expect(b).toEqual(a);
  });
});
