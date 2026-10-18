/**
 * An index written by an older parser is rebuilt on the next incremental run
 * even though no file changed (Map M0: resolution rules changed under it).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexFixture, type IndexedFixture } from './harness.js';
import { PARSER_VERSION } from '../../src/manifest/version.js';

let fx: IndexedFixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

describe('parser version upgrade', () => {
  it('re-parses every file once when the manifest names an older parser, then goes back to incremental', async () => {
    fx = await indexFixture('ts-esm');
    const total = fx.result.filesDiscovered;
    expect((await fx.reindex()).filesIndexed).toBe(0);

    const manifest = join(fx.root, '.flowlens/manifest.json');
    const m = JSON.parse(readFileSync(manifest, 'utf-8'));
    expect(m.parser_version).toBe(PARSER_VERSION);
    writeFileSync(manifest, JSON.stringify({ ...m, parser_version: '8.0.0' }));

    const upgraded = await fx.reindex();
    expect(upgraded.filesIndexed).toBe(total);
    expect(JSON.parse(readFileSync(manifest, 'utf-8')).parser_version).toBe(PARSER_VERSION);
    expect((await fx.reindex()).filesIndexed).toBe(0);
  });

  it('still drops files that disappeared while upgrading', async () => {
    fx = await indexFixture('ts-esm');
    const manifest = join(fx.root, '.flowlens/manifest.json');
    const m = JSON.parse(readFileSync(manifest, 'utf-8'));
    writeFileSync(manifest, JSON.stringify({ ...m, parser_version: '8.0.0' }));
    const { rmSync } = await import('node:fs');
    rmSync(join(fx.root, 'src/models/user.ts'));
    const run = await fx.reindex();
    expect(run.filesDeleted).toBe(1);
    expect(fx.nodes.some((n) => n.file === 'src/models/user.ts')).toBe(false);
  });
});
