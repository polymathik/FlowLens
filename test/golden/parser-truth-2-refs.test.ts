/**
 * Parser truth 2 golden, item 5: handler references (call arguments, route
 * tables), JSX elements and attribute bindings, Svelte/Vue template bindings.
 * Uses the `parser-truth-2` fixture (Hono-like server, SvelteKit-like web app).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { indexFixture, findEdge, type IndexedFixture } from './harness.js';

const FIXTURE = join(import.meta.dirname, '../fixtures/parser-truth-2');
const APP = 'apps/server/src/app.ts';
const WEB = 'apps/web/src';
const COMPONENTS = `${WEB}/lib/components`;

let fx: IndexedFixture | null = null;
afterEach(async () => { await fx?.cleanup(); fx = null; });

describe('handler references', () => {
  it('links module-scope route registrations to the handlers, same file and imported', async () => {
    fx = await indexFixture(FIXTURE);
    const local = findEdge(fx, 'use', APP, `${APP}/sessionList`);
    expect(local?.meta).toEqual({ owner: 'module', ref: 'argument', ref_via: 'app.get' });
    const imported = findEdge(fx, 'use', APP, 'apps/server/src/boot.ts/onShutdown');
    expect(imported?.meta).toEqual({ owner: 'module', ref: 'argument', ref_via: 'process.on' });
  });

  it('does not turn plain module-scope arguments into references', async () => {
    fx = await indexFixture(FIXTURE);
    // `boot(app)` / `app.get('/health', cb)`: app is a variable, not a handler
    const toVariables = fx.edges.filter((e) => e.type === 'use' && fx!.byId.get(e.from)?.kind === 'file' && fx!.byId.get(e.to)?.kind === 'variable');
    expect(toVariables).toEqual([]);
  });
});

describe('JSX', () => {
  it('creates edges for component elements (local import, namespace member) and uses for handler attributes', async () => {
    fx = await indexFixture(FIXTURE);
    const toolbar = `${COMPONENTS}/Toolbar.tsx/Toolbar`;
    const badge = findEdge(fx, 'create', toolbar, `${COMPONENTS}/Badge.tsx/Badge`);
    expect(badge?.weight).toBe(2); // <Badge /> and <pieces.Badge />
    const pick = findEdge(fx, 'use', toolbar, `${COMPONENTS}/Toolbar.tsx/onPick`);
    expect(pick?.meta).toEqual({ ref: 'binding', ref_via: 'onClick' });
    expect(findEdge(fx, 'use', toolbar, `${WEB}/lib/format.ts/formatName`)?.meta?.ref_via).toBe('onFocus');
  });

  it('skips attributes whose value is a (renamed) parameter and DOM elements', async () => {
    fx = await indexFixture(FIXTURE);
    const toolbar = fx.nodes.find((n) => n.qualified_name === `${COMPONENTS}/Toolbar.tsx/Toolbar`);
    const targets = fx.edges.filter((e) => e.from === toolbar?.id && (e.type === 'use' || e.type === 'create')).map((e) => fx!.byId.get(e.to)?.name).sort();
    expect(targets).toEqual(['Badge', 'formatName', 'onPick']);
  });
});

describe('Svelte template bindings', () => {
  it('records handler, bind and prop references from the markup', async () => {
    fx = await indexFixture(FIXTURE);
    const page = `${WEB}/routes/+page.svelte`;
    const uses = fx.edges
      .filter((e) => e.type === 'use' && fx!.byId.get(e.from)?.file === page && e.meta?.ref === 'binding')
      .map((e) => `${fx!.byId.get(e.to)?.name} ${e.meta?.ref_via}`).sort();
    expect(uses).toEqual(['load onclick', 'query bind:value', 'reset onclose']);
  });
});
