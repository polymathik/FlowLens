import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createZoneOverridesStore, InvalidZoneOverridesError, zonesFilePath } from '../../../src/analysis/zones/overrides-store.js';
import { parseZoneOverrides } from '../../../src/analysis/zones/overrides-schema.js';
import { EMPTY_ZONE_OVERRIDES, type ZoneOverrides } from '../../../src/contracts/zones.js';
import { removeDir, tempDir } from '../../helpers/service-env.js';

const dirs: string[] = [];
const fresh = async (): Promise<string> => {
  const d = join(await tempDir('flowlens-zones-'), '.flowlens');
  dirs.push(d);
  return d;
};
afterEach(async () => {
  for (const d of dirs.splice(0)) await removeDir(join(d, '..'));
});

const sample: ZoneOverrides = {
  version: 1,
  zones: { 'folders:src': { name: 'Source', color: 3, collapsed: true }, 'packages:@a/b': { mergeInto: 'packages:core' } },
  pins: { 'src/a.ts': 'folders:docs' },
};

describe('zone overrides store', () => {
  it('returns empty overrides when the file is missing, without creating anything (and never the shared constant)', async () => {
    const dir = await fresh();
    const store = createZoneOverridesStore();
    const got = await store.read(dir);
    expect(got).toEqual(EMPTY_ZONE_OVERRIDES);
    expect(got).not.toBe(EMPTY_ZONE_OVERRIDES);
    got.pins.x = 'y';
    expect(EMPTY_ZONE_OVERRIDES.pins).toEqual({});
    await expect(readdir(dir)).rejects.toThrow();
  });

  it('round-trips, creates .flowlens and writes sorted, pretty JSON with a trailing newline', async () => {
    const dir = await fresh();
    const store = createZoneOverridesStore();
    await store.write(dir, { ...sample, zones: { 'z:last': {}, ...sample.zones } });
    expect(await store.read(dir)).toEqual({ ...sample, zones: { ...sample.zones, 'z:last': {} } });
    const text = await readFile(zonesFilePath(dir), 'utf-8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(text).zones)).toEqual(['folders:src', 'packages:@a/b', 'z:last']);
  });

  it('a corrupt file reads as empty, is kept as zones.json.corrupt, and does not break the next write', async () => {
    const dir = await fresh();
    await mkdir(dir, { recursive: true });
    await writeFile(zonesFilePath(dir), '{"version":1,"zones":{', 'utf-8');
    const store = createZoneOverridesStore();
    expect(await store.read(dir)).toEqual(EMPTY_ZONE_OVERRIDES);
    expect(await readFile(`${zonesFilePath(dir)}.corrupt`, 'utf-8')).toBe('{"version":1,"zones":{');
    await expect(readFile(zonesFilePath(dir), 'utf-8')).rejects.toThrow();
    await store.write(dir, sample);
    expect(await store.read(dir)).toEqual(sample);
  });

  it('valid JSON of the wrong shape or a newer version is also set aside, not thrown', async () => {
    const store = createZoneOverridesStore();
    for (const body of ['[]', '{"version":2,"zones":{},"pins":{}}', '{"version":1,"zones":{"a":{"color":99}},"pins":{}}', 'null', '']) {
      const dir = await fresh();
      await mkdir(dir, { recursive: true });
      await writeFile(zonesFilePath(dir), body, 'utf-8');
      expect(await store.read(dir)).toEqual(EMPTY_ZONE_OVERRIDES);
      expect(await readFile(`${zonesFilePath(dir)}.corrupt`, 'utf-8')).toBe(body);
    }
  });

  it('refuses to write an invalid document and leaves the stored one untouched', async () => {
    const dir = await fresh();
    const store = createZoneOverridesStore();
    await store.write(dir, sample);
    await expect(store.write(dir, { version: 1, zones: { a: { color: 7 } }, pins: {} })).rejects.toBeInstanceOf(InvalidZoneOverridesError);
    expect(await store.read(dir)).toEqual(sample);
  });

  it('is atomic: overlapping writes leave exactly one complete document and no temp files', async () => {
    const dir = await fresh();
    const store = createZoneOverridesStore();
    const docs = Array.from({ length: 25 }, (_, i): ZoneOverrides => ({
      version: 1, zones: Object.fromEntries(Array.from({ length: 200 }, (_, k) => [`folders:dir${k}`, { name: `n${i}-${k}` }])), pins: { [`f${i}.ts`]: 'folders:x' },
    }));
    await Promise.all(docs.map((d) => store.write(dir, d)));
    const final = await store.read(dir);
    expect(docs).toContainEqual(final);
    expect(final).toEqual(docs[docs.length - 1]); // writes are applied in call order
    expect((await readdir(dir)).sort()).toEqual(['zones.json']);
  });

  it('a failed write (target is a directory) keeps the previous bytes and cleans its temp file', async () => {
    const dir = await fresh();
    await mkdir(join(zonesFilePath(dir)), { recursive: true });
    const store = createZoneOverridesStore();
    await expect(store.write(dir, sample)).rejects.toThrow();
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('parseZoneOverrides', () => {
  it('drops unknown fields, trims names and reports dotted paths', () => {
    const ok = parseZoneOverrides({ version: 1, zones: { 'folders:a': { name: ' X ', extra: 1 } }, pins: {}, junk: true });
    expect(ok).toEqual({ ok: true, value: { version: 1, zones: { 'folders:a': { name: 'X' } }, pins: {} } });
    const bad = parseZoneOverrides({ version: 1, zones: { 'folders:a': { color: 6, name: '' } }, pins: { 'a.ts': 3 } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.map((i) => i.path).sort()).toEqual(['pins.a.ts', 'zones.folders:a.color', 'zones.folders:a.name']);
  });

  it('rejects __proto__ keys, missing version and non-objects', () => {
    expect(parseZoneOverrides(JSON.parse('{"version":1,"zones":{"__proto__":{"name":"x"}},"pins":{}}')).ok).toBe(false);
    expect(parseZoneOverrides(JSON.parse('{"version":1,"zones":{},"pins":{"__proto__":"a"}}')).ok).toBe(false);
    for (const raw of [{}, { zones: {}, pins: {} }, 'x', 3, null, undefined]) expect(parseZoneOverrides(raw).ok).toBe(false);
  });

  it('accepts a minimal {version:1} and fills zones and pins', () => {
    expect(parseZoneOverrides({ version: 1 })).toEqual({ ok: true, value: EMPTY_ZONE_OVERRIDES });
  });
});
