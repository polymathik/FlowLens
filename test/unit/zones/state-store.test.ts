import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createZoneStateStore, InvalidZoneStateError, zoneStatePath } from '../../../src/analysis/zones/state-store.js';
import { parseZoneState } from '../../../src/analysis/zones/state-schema.js';
import { EMPTY_ZONE_STATE, ZONE_STATE_MAX_FILES, type ZoneState } from '../../../src/contracts/zones.js';
import { removeDir, tempDir } from '../../helpers/service-env.js';

const dirs: string[] = [];
const fresh = async (): Promise<string> => {
  const d = join(await tempDir('flowlens-zone-state-'), '.flowlens');
  dirs.push(d);
  return d;
};
afterEach(async () => {
  for (const d of dirs.splice(0)) await removeDir(join(d, '..'));
});

const sample: ZoneState = { version: 1, assignment: { 'src/a.ts': 'pkg/auth', 'src/b.ts': 'pkg/auth', 'src/c.ts': 'pkg/billing' } };

describe('zone state store', () => {
  it('reads an empty state when the file is missing (never the shared constant) and creates nothing', async () => {
    const dir = await fresh();
    const got = await createZoneStateStore().read(dir);
    expect(got).toEqual(EMPTY_ZONE_STATE);
    expect(got).not.toBe(EMPTY_ZONE_STATE);
    await expect(readdir(dir)).rejects.toThrow();
  });

  it('round-trips and writes sorted keys', async () => {
    const dir = await fresh();
    const store = createZoneStateStore();
    await store.write(dir, { version: 1, assignment: { 'z.ts': 'k', 'a.ts': 'k' } });
    expect(Object.keys(JSON.parse(await readFile(zoneStatePath(dir), 'utf-8')).assignment)).toEqual(['a.ts', 'z.ts']);
    await store.write(dir, sample);
    expect(await store.read(dir)).toEqual(sample);
    expect((await readdir(dir)).sort()).toEqual(['zone-state.json']);
  });

  it('sets a corrupt or wrong-shaped file aside as zone-state.json.corrupt and reads empty', async () => {
    const store = createZoneStateStore();
    for (const body of ['{"version":1,"assignment":{', '[]', '{"version":2,"assignment":{}}', '{"version":1,"assignment":{"a":3}}', '']) {
      const dir = await fresh();
      await mkdir(dir, { recursive: true });
      await writeFile(zoneStatePath(dir), body, 'utf-8');
      expect(await store.read(dir)).toEqual(EMPTY_ZONE_STATE);
      expect(await readFile(`${zoneStatePath(dir)}.corrupt`, 'utf-8')).toBe(body);
    }
  });

  it('refuses an invalid document and keeps the stored one', async () => {
    const dir = await fresh();
    const store = createZoneStateStore();
    await store.write(dir, sample);
    await expect(store.write(dir, { version: 1, assignment: { 'a.ts': '' } })).rejects.toBeInstanceOf(InvalidZoneStateError);
    expect(await store.read(dir)).toEqual(sample);
  });

  it('is atomic under overlapping writes: the last call wins, no temp files remain', async () => {
    const dir = await fresh();
    const store = createZoneStateStore();
    const docs = Array.from({ length: 20 }, (_, i): ZoneState => ({
      version: 1, assignment: Object.fromEntries(Array.from({ length: 300 }, (_, k) => [`src/f${k}.ts`, `pkg/zone-${i}`])),
    }));
    await Promise.all(docs.map((d) => store.write(dir, d)));
    expect(await store.read(dir)).toEqual(docs[docs.length - 1]);
    expect((await readdir(dir)).sort()).toEqual(['zone-state.json']);
  });
});

describe('parseZoneState', () => {
  it('drops unknown fields, fills a missing assignment and rejects __proto__ keys, bad versions and non-objects', () => {
    expect(parseZoneState({ version: 1, assignment: { 'a.ts': 'k' }, junk: 1 })).toEqual({ ok: true, value: { version: 1, assignment: { 'a.ts': 'k' } } });
    expect(parseZoneState({ version: 1 })).toEqual({ ok: true, value: EMPTY_ZONE_STATE });
    expect(parseZoneState(JSON.parse('{"version":1,"assignment":{"__proto__":"x"}}')).ok).toBe(false);
    for (const raw of [{}, { version: 2, assignment: {} }, 'x', 3, null, undefined]) expect(parseZoneState(raw).ok).toBe(false);
  });

  it(`refuses more than ${ZONE_STATE_MAX_FILES} files`, () => {
    const assignment = Object.fromEntries(Array.from({ length: ZONE_STATE_MAX_FILES + 1 }, (_, i) => [`f${i}`, 'k']));
    const res = parseZoneState({ version: 1, assignment });
    expect(res.ok).toBe(false);
  });
});
