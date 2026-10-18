import { describe, it, expect } from 'vitest';
import { detectEntryPoints } from '../../../src/flow/entry-points.js';
import { buildGraph, type FileSpec } from '../../helpers/flow-graph.js';

const pkg = (deps: Record<string, string>): FileSpec => ({ text: JSON.stringify({ name: 'x', dependencies: deps }), language: 'json', role: 'config' });
const run = (files: Record<string, FileSpec>) => {
  const b = buildGraph(files);
  return { b, eps: detectEntryPoints(b.graph, b.source) };
};
const pair = (eps: ReturnType<typeof run>['eps']) => eps.map((e) => `${e.kind}|${e.label}`);

describe('file-based routes', () => {
  it('SvelteKit: pages, layouts, load, +server verbs, groups and params', () => {
    const { eps, b } = run({
      'apps/web/src/routes/+page.svelte': { symbols: [{ qn: '+page', kind: 'component' }] },
      'apps/web/src/routes/+layout.svelte': { symbols: [{ qn: '+layout', kind: 'component' }] },
      'apps/web/src/routes/(app)/sessions/[id]/+page.svelte': { symbols: [{ qn: '+page', kind: 'component' }] },
      'apps/web/src/routes/(app)/sessions/[id]/+page.server.ts': { symbols: [{ qn: 'load' }, { qn: 'actions', kind: 'variable' }] },
      'apps/web/src/routes/api/s/+server.ts': { symbols: [{ qn: 'GET' }, { qn: 'POST', kind: 'function' }, { qn: 'helper' }] },
      'apps/web/src/hooks.server.ts': { symbols: [{ qn: 'handle' }] },
    });
    expect(pair(eps).sort()).toEqual([
      'event_handler|hook hooks.server handle',
      'http_route|GET /api/s',
      'http_route|POST /api/s',
      'http_route|POST /sessions/[id] (form actions)',
      'page_route|layout /',
      'page_route|load /sessions/[id]',
      'page_route|page /',
      'page_route|page /sessions/[id]',
    ].sort());
    expect(eps.find((e) => e.label === 'page /')?.entity_id).toBe(b.id('apps/web/src/routes/+page.svelte/+page'));
  });

  it('Next.js app router and pages router, gated on the next dependency', () => {
    const { eps } = run({
      'package.json': pkg({ next: '14' }),
      'app/page.tsx': { symbols: [{ qn: 'Page' }] },
      'app/blog/[slug]/page.tsx': { symbols: [{ qn: 'Helper' }, { qn: 'BlogPage' }] },
      'app/api/users/route.ts': { symbols: [{ qn: 'GET' }, { qn: 'DELETE' }] },
      'pages/index.tsx': { symbols: [{ qn: 'Home' }] },
      'pages/api/hello.ts': { symbols: [{ qn: 'handler' }] },
      'pages/_app.tsx': { symbols: [{ qn: 'App' }] },
      'middleware.ts': { symbols: [{ qn: 'middleware' }] },
    });
    expect(pair(eps).sort()).toEqual([
      'event_handler|middleware (every matched request)',
      'http_route|ANY /api/hello',
      'http_route|DELETE /api/users',
      'http_route|GET /api/users',
      'page_route|page /',
      'page_route|page /',
      'page_route|page /blog/[slug]',
    ].sort());
    expect(eps.find((e) => e.label === 'page /blog/[slug]')?.qualified_name).toBe('app/blog/[slug]/page.tsx/BlogPage');
  });

  it('a pages/ folder without a framework dependency is low confidence; app/ without next is ignored', () => {
    const noDep = run({ 'package.json': pkg({ vite: '5' }), 'src/pages/Home.tsx': { symbols: [{ qn: 'Home' }] }, 'app/page.tsx': { symbols: [{ qn: 'Page' }] } });
    expect(noDep.eps.filter((e) => e.kind === 'page_route')).toHaveLength(0);
    const unknown = run({ 'pages/index.tsx': { symbols: [{ qn: 'Home' }] } });
    expect(unknown.eps[0]).toMatchObject({ kind: 'page_route', confidence: 0.45 });
  });

  it('Remix flat routes and Nuxt pages / server routes', () => {
    const remix = run({
      'package.json': pkg({ '@remix-run/react': '2' }),
      'app/routes/_index.tsx': { symbols: [{ qn: 'Index' }] },
      'app/routes/users.$id.tsx': { symbols: [{ qn: 'User' }, { qn: 'loader' }, { qn: 'action' }] },
      'app/routes/_auth.login.tsx': { symbols: [{ qn: 'Login' }] },
    });
    expect(pair(remix.eps).sort()).toEqual([
      'http_route|GET /users/:id (loader)', 'http_route|POST /users/:id (action)', 'page_route|page /', 'page_route|page /login', 'page_route|page /users/:id',
    ].sort());
    const nuxt = run({
      'package.json': pkg({ nuxt: '3' }),
      'pages/index.vue': { symbols: [{ qn: 'index', kind: 'component' }] },
      'pages/about.vue': { symbols: [{ qn: 'about', kind: 'component' }] },
      'server/api/ping.get.ts': { symbols: [{ qn: 'handler' }] },
      'server/api/echo.ts': {},
    });
    expect(pair(nuxt.eps).sort()).toEqual(['http_route|ANY /api/echo', 'http_route|GET /api/ping', 'page_route|page /', 'page_route|page /about'].sort());
  });

  it('does not treat test files as routes', () => {
    const { eps } = run({ 'app/page.test.tsx': { role: 'test', symbols: [{ qn: 'Page' }] }, 'package.json': pkg({ next: '14' }) });
    expect(eps.filter((e) => e.kind !== 'test')).toHaveLength(0);
  });
});
