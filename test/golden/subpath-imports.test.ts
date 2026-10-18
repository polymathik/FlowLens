/**
 * Parser truth 2, item 1: Node `#subpath` imports (package.json `imports`) in a
 * Halcyon-shaped SvelteKit app. Before: such imports vanished (classified
 * external) and "unresolved refs: 0" was misleading.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { indexFixture, edgeStrings, type IndexedFixture } from './harness.js';

const FIXTURE = join(import.meta.dirname, '../fixtures/parser-truth-2');
const WEB = 'apps/web/src';

let fx: IndexedFixture | null = null;
afterEach(async () => { await fx?.cleanup(); fx = null; });

describe('package.json imports (#lib/*) end to end', () => {
  it('turns #lib imports into resolved file edges, calls and component creates', async () => {
    fx = await indexFixture(FIXTURE);
    const edges = edgeStrings(fx, ['import', 'call', 'create']);
    expect(edges).toEqual(expect.arrayContaining([
      // route page → lib files through `#lib/*` and the exact `#lib` key (barrel → format.ts)
      `import ${WEB}/routes/+page.svelte -> ${WEB}/lib/api.ts`,
      `import ${WEB}/routes/+page.svelte -> ${WEB}/lib/index.ts`,
      `import ${WEB}/routes/+page.svelte -> ${WEB}/lib/prefs.ts`,
      `import ${WEB}/routes/+page.svelte -> ${WEB}/lib/components/Canvas.svelte`,
      `call ${WEB}/routes/+page.svelte/load -> ${WEB}/lib/prefs.ts/writeTextPref`,
      `call ${WEB}/routes/+page.svelte/load -> ${WEB}/lib/format.ts/formatName`,
      `create ${WEB}/routes/+page.svelte/+page -> ${WEB}/lib/components/Canvas.svelte/Canvas`,
      `create ${WEB}/lib/components/Canvas.svelte/Canvas -> ${WEB}/lib/components/Icon.svelte/Icon`,
      // $lib still works next to #lib; a `dist/` subpath target maps back to source
      `import ${WEB}/routes/+page.svelte -> ${WEB}/lib/util.ts`,
      `import ${WEB}/lib/util.ts -> ${WEB}/lib/format.ts`,
      `import ${WEB}/lib/util.ts -> ${WEB}/lib/prefs.ts`,
      `call ${WEB}/lib/util.ts/title -> ${WEB}/lib/format.ts/formatName`,
      `call ${WEB}/lib/util.ts/title -> packages/core/src/ids.ts/parseId`,
    ]));
  });

  it('records a declared #import with no file as unresolved; $app/$env stay external', async () => {
    fx = await indexFixture(FIXTURE);
    const unresolved = fx.unresolved.map((u) => `${u.type} ${u.target_name}`);
    // the import itself and the call through the unresolvable binding — nothing else
    expect(unresolved.sort()).toEqual(['call ghost', 'import #lib/ghost.js']);
    expect(fx.result.quality?.unresolved_count).toBe(2);
  });

  it('adding the missing file heals the importer incrementally', async () => {
    const { writeFileSync } = await import('node:fs');
    fx = await indexFixture(FIXTURE);
    writeFileSync(join(fx.root, WEB, 'lib/ghost.ts'), 'export function ghost(): void {}\n');
    await fx.reindex();
    expect(fx.unresolved).toEqual([]);
    expect(edgeStrings(fx, ['import', 'call'])).toContain(`import ${WEB}/routes/+page.svelte -> ${WEB}/lib/ghost.ts`);
  });

  it('editing package.json imports re-resolves its #-importers', async () => {
    const { writeFileSync, readFileSync } = await import('node:fs');
    fx = await indexFixture(FIXTURE);
    const pj = join(fx.root, 'apps/web/package.json');
    const j = JSON.parse(readFileSync(pj, 'utf-8'));
    j.imports['#lib/*'] = './src/elsewhere/*';
    writeFileSync(pj, JSON.stringify(j));
    await fx.reindex();
    expect(edgeStrings(fx, ['import'])).not.toContain(`import ${WEB}/routes/+page.svelte -> ${WEB}/lib/api.ts`);
    expect(fx.unresolved.map((u) => u.target_name)).toContain('#lib/api.js');
  });
});
