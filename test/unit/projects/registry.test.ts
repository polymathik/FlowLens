import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { FileProjectRegistry } from '../../../src/projects/registry.js';
import { readProjectIdentity } from '../../../src/utils/project-identity.js';
import { REPO, tempDir, removeDir } from '../../helpers/service-env.js';
import { restoreEnv } from '../../helpers/daemon-harness.js';

function makeProject(base: string, name: string): string {
  const root = join(base, name);
  mkdirSync(join(root, '.flowlens'), { recursive: true });
  return root;
}

describe('FileProjectRegistry', () => {
  let home: string;
  let base: string;
  let reg: FileProjectRegistry;
  const outerHome = process.env.FLOWLENS_HOME;

  beforeEach(async () => {
    home = await tempDir('flowlens-home-');
    base = await tempDir('flowlens-roots-');
    process.env.FLOWLENS_HOME = home;
    reg = new FileProjectRegistry();
  });

  afterEach(async () => {
    restoreEnv('FLOWLENS_HOME', outerHome);
    await removeDir(home);
    await removeDir(base);
  });

  it('registers idempotently with id == .flowlens/project.json id', async () => {
    const root = makeProject(base, 'app');
    const a = await reg.register(root);
    const b = await reg.register(join(root, '.', '..', 'app'));
    expect(b.id).toBe(a.id);
    expect(readProjectIdentity(join(root, '.flowlens'))?.id).toBe(a.id);
    expect(await reg.list()).toHaveLength(1);
    expect((await reg.findByRoot(root))?.status).toBe('ok');
    expect(JSON.parse(readFileSync(join(home, 'projects.json'), 'utf8')).version).toBe(1);
  });

  it('gives duplicate directory names unique display names and validates rename', async () => {
    const a = await reg.register(makeProject(join(base, 'one'), 'app'));
    const b = await reg.register(makeProject(join(base, 'two'), 'app'));
    expect(a.name).toBe('app');
    expect(b.name).toBe('app-2');
    await expect(reg.rename(b.id, 'app')).rejects.toThrow(/already exists/);
    expect((await reg.rename(b.id, 'web')).name).toBe('web');
    expect((await reg.lookup('web'))?.id).toBe(b.id);
    expect(await reg.remove(a.id)).toBe(true);
    expect(await reg.remove(a.id)).toBe(false);
    expect((await reg.list()).map((p) => p.name)).toEqual(['web']);
  });

  it('reports deleted and moved projects as missing, and re-links a moved project', async () => {
    const root = makeProject(base, 'mover');
    const deleted = makeProject(base, 'gone');
    const rec = await reg.register(root);
    const goneRec = await reg.register(deleted);
    await rm(deleted, { recursive: true });
    const moved = join(base, 'moved-here');
    renameSync(root, moved);
    expect((await reg.get(rec.id))?.status).toBe('missing');
    expect((await reg.get(goneRec.id))?.status).toBe('missing');

    const relinked = await reg.register(moved);
    expect(relinked.id).toBe(rec.id);
    expect(relinked.name).toBe('mover');
    expect((await reg.get(rec.id))?.root).toBe(moved);
    expect((await reg.get(rec.id))?.status).toBe('ok');
  });

  it('restores project.json after .flowlens/ is recreated (init --force)', async () => {
    const root = makeProject(base, 'reset');
    const rec = await reg.register(root);
    await rm(join(root, '.flowlens'), { recursive: true });
    mkdirSync(join(root, '.flowlens'));
    expect((await reg.register(root)).id).toBe(rec.id);
    expect(readProjectIdentity(join(root, '.flowlens'))?.id).toBe(rec.id);
  });

  it('gives a copied .flowlens/ its own id', async () => {
    const a = makeProject(base, 'orig');
    const recA = await reg.register(a);
    const b = join(base, 'copy');
    mkdirSync(join(b, '.flowlens'), { recursive: true });
    const { cpSync } = await import('node:fs');
    cpSync(join(a, '.flowlens', 'project.json'), join(b, '.flowlens', 'project.json'));
    const recB = await reg.register(b);
    expect(recB.id).not.toBe(recA.id);
    expect(readProjectIdentity(join(b, '.flowlens'))?.id).toBe(recB.id);
  });

  it('touch updates last_indexed and rejects unknown ids', async () => {
    const rec = await reg.register(makeProject(base, 't'));
    await reg.touch(rec.id, { last_indexed: '2026-10-18T00:00:00.000Z' });
    expect((await reg.get(rec.id))?.last_indexed).toBe('2026-10-18T00:00:00.000Z');
    await expect(reg.touch('nope', { last_indexed: null })).rejects.toThrow(/Unknown project/);
  });

  it('loses no entries when 6 processes register 4 projects each concurrently', async () => {
    const roots: string[][] = [];
    for (let p = 0; p < 6; p++) {
      roots.push(Array.from({ length: 4 }, (_, i) => makeProject(base, `p${p}-${i}`)));
    }
    // Every process also registers one shared root (idempotency under contention).
    const shared = makeProject(base, 'shared');
    await Promise.all(roots.map((rs) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', join(REPO, 'test/helpers/register-child.ts'), shared, ...rs], {
        env: { ...process.env, FLOWLENS_HOME: home }, stdio: 'inherit',
      });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`child exit ${code}`))));
    })));
    const list = await reg.list();
    expect(list).toHaveLength(25);
    expect(new Set(list.map((p) => p.id)).size).toBe(25);
    expect(new Set(list.map((p) => p.name)).size).toBe(25);
    expect(existsSync(join(home, 'projects.json.lock'))).toBe(false);
  }, 60_000);

  it('fails loudly on a corrupt registry instead of overwriting it', async () => {
    const { writeFileSync } = await import('node:fs');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'projects.json'), '{ not json');
    await expect(reg.register(makeProject(base, 'x'))).rejects.toThrow(/not valid JSON/);
    expect(readFileSync(join(home, 'projects.json'), 'utf8')).toBe('{ not json');
  });
});
