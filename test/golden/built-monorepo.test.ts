/**
 * Map M0 golden: a pnpm monorepo shaped like Halcyon (packages built to a
 * gitignored `dist/`, a SvelteKit app, a barrel, symbol-less files). Every
 * assertion runs twice — once with the build output present on disk (the
 * D1 bug: imports resolved into the excluded `dist/` and became unresolved)
 * and once without it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexFixture, edgeStrings, findEdge, danglingEdges, type IndexedFixture } from './harness.js';
import { buildOutput, BUILT_MONOREPO_PACKAGES } from '../helpers/built-output.js';

const FIXTURE = join(import.meta.dirname, '../fixtures/built-monorepo');
const ALL_TYPES = ['import', 'call', 'create', 'implement', 'parameter', 'return', 'extend', 'use'] as const;

const CORE = 'packages/core/src';
const SERVER = 'packages/server/src';
const WEB = 'apps/web/src/lib/components';

let fx: IndexedFixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

function lineOf(file: string, needle: string): number {
  const lines = readFileSync(join(FIXTURE, file), 'utf-8').split('\n');
  const idx = lines.findIndex((l) => l.includes(needle));
  if (idx < 0) throw new Error(`${needle} not in ${file}`);
  return idx + 1;
}

describe.each([
  { label: 'with a built dist/', built: true },
  { label: 'without dist/', built: false },
])('built monorepo ($label)', ({ built }) => {
  const index = () => indexFixture(FIXTURE, built ? (root) => {
    const written = buildOutput(root, BUILT_MONOREPO_PACKAGES);
    expect(written.length).toBeGreaterThan(0);
    expect(existsSync(join(root, 'packages/core/dist/index.js'))).toBe(true);
  } : undefined);

  it('resolves every cross-package reference to the SOURCE entity (0 unresolved)', async () => {
    fx = await index();
    expect(fx.unresolved).toEqual([]);
    expect(danglingEdges(fx)).toEqual([]);
    // nothing in the graph lives in build output
    expect(fx.nodes.filter((n) => /\/(dist|compiled)\//.test(n.file))).toEqual([]);

    const edges = edgeStrings(fx, [...ALL_TYPES]);
    const svc = `${SERVER}/live/service.ts`;
    expect(edges).toEqual(expect.arrayContaining([
      // package entry through `exports["."]`, barrel re-export chain, deep subpath via `exports["./utils/*"]`
      `import ${svc} -> ${CORE}/index.ts`,
      `import ${svc} -> ${CORE}/session.ts`,
      `import ${svc} -> ${CORE}/utils/format.ts`,
      // package whose tsconfig uses rootDir ./source + outDir ./compiled (main/types point into compiled/)
      `import ${svc} -> packages/shared/source/index.ts`,
      `call ${svc}/LiveService.describe -> packages/shared/source/index.ts/clamp`,
      `call ${svc}/LiveService.describe -> ${CORE}/utils/format.ts/formatDuration`,
      `call ${svc}/LiveService.start -> ${CORE}/session.ts/createSession`,
      `create ${svc}/LiveService -> ${CORE}/session.ts/SessionStore`,
      `implement ${svc}/LiveService -> ${CORE}/session.ts/SessionSink`,
      `parameter ${svc}/LiveService.write -> ${CORE}/session.ts/Session`,
      `return ${svc}/LiveService.start -> ${CORE}/session.ts/Session`,
      // web app (Svelte) → core / shared
      `call ${WEB}/Card.svelte/Card -> ${CORE}/utils/format.ts/formatDuration`,
      `call ${WEB}/List.svelte/visible -> packages/shared/source/index.ts/clamp`,
      `return ${WEB}/List.svelte/visible -> ${CORE}/session.ts/Session`,
    ]));
    const crossPackage = edges.filter((e) => {
      const [, from, to] = /^\w+ (\S+) -> (\S+)$/.exec(e)!;
      const pkg = (p: string) => p.split('/').slice(0, 2).join('/');
      return pkg(from) !== pkg(to);
    });
    expect(crossPackage.length).toBeGreaterThanOrEqual(25);
  });

  it('indexes Svelte and Vue components with correct lines and script symbols', async () => {
    fx = await index();
    const card = `${WEB}/Card.svelte`;
    const entityOf = (file: string, qn: string) => fx!.nodes.find((n) => n.file === file && n.qualified_name === qn);

    const comp = entityOf(card, `${card}/Card`);
    expect(comp?.kind).toBe('component');
    expect(comp?.language).toBe('svelte');
    const total = readFileSync(join(FIXTURE, card), 'utf-8').trimEnd().split('\n').length;
    expect(comp?.location.line_start).toBe(1);
    expect(comp?.location.line_end).toBe(total);

    const select = entityOf(card, `${card}/select`);
    expect(select?.kind).toBe('function');
    expect(select?.location.line_start).toBe(lineOf(card, 'function select'));
    expect(select?.location.line_end).toBe(lineOf(card, 'function select') + 2);

    // `<script context="module">` and the instance script of one file
    const list = `${WEB}/List.svelte`;
    expect(entityOf(list, `${list}/PAGE_SIZE`)?.location.line_start).toBe(lineOf(list, 'PAGE_SIZE = 20'));
    expect(entityOf(list, `${list}/visible`)?.location.line_start).toBe(lineOf(list, 'function visible'));

    // Vue <script setup>, component name from the file
    const panel = `${WEB}/Panel.vue`;
    expect(entityOf(panel, `${panel}/Panel`)?.kind).toBe('component');
    expect(entityOf(panel, `${panel}/label`)?.location.line_start).toBe(lineOf(panel, 'function label'));

    const edges = edgeStrings(fx, ['create', 'call', 'import']);
    expect(edges).toEqual(expect.arrayContaining([
      `create ${card}/Card -> ${WEB}/Icon.svelte/Icon`,               // <Icon /> from an import
      `create ${list}/List -> ${card}/Card`,                          // <Card /> via the SvelteKit $lib alias
      `create apps/web/src/routes/+page.svelte/+page -> ${list}/List`,
      `create ${panel}/Panel -> ${WEB}/Badge.vue/Badge`,              // <my-badge /> (kebab-case) for `import MyBadge`
      `call ${panel}/Panel -> ${panel}/label`,                        // {{ label() }} in the template
      `import apps/web/src/lib/index.ts -> ${card}`,                  // barrel re-exporting a component
    ]));
    // a component mentioned only inside an HTML comment is not a usage
    expect(edges.filter((e) => e.startsWith(`create ${card}/Card -> `))).toEqual([`create ${card}/Card -> ${WEB}/Icon.svelte/Icon`]);
    // the 10-ish component set, one component entity per .svelte/.vue file
    expect(fx.nodes.filter((n) => n.kind === 'component').map((n) => n.name).sort())
      .toEqual(['+page', 'Badge', 'Card', 'Icon', 'List', 'Panel']);
  });

  it('records symbol-less files and re-export barrels, and classifies file roles', async () => {
    fx = await index();
    const files = new Map(fx.nodes.filter((n) => n.kind === 'file').map((n) => [n.file, n]));
    for (const f of ['apps/web/src/app.d.ts', 'apps/web/src/app.css', `${CORE}/index.ts`, 'apps/web/src/lib/index.ts', `${SERVER}/index.ts`]) {
      expect(files.has(f), f).toBe(true);
      const symbols = fx.nodes.filter((n) => n.file === f && n.kind !== 'file' && n.kind !== 'module');
      expect(symbols, `${f} has no symbols`).toEqual([]);
    }
    expect(files.get('apps/web/src/app.d.ts')?.metrics?.line_count).toBe(2);

    const role = (f: string) => files.get(f)?.file_role;
    expect(role('package.json')).toBe('config');
    expect(role('packages/core/package.json')).toBe('config');
    expect(role('tsconfig.base.json')).toBe('config');
    expect(role('pnpm-workspace.yaml')).toBe('config');
    expect(role('apps/web/svelte.config.js')).toBe('config');
    expect(role('pnpm-lock.yaml')).toBe('generated');
    expect(role(`${CORE}/index.ts`)).toBe('source');
    expect(role(`${WEB}/Card.svelte`)).toBe('source');

    // re-exports are flagged so a view can tell a barrel from a consumer
    const barrel = findEdge(fx, 'import', `${CORE}/index.ts`, `${CORE}/session.ts`);
    expect(barrel?.meta?.reexport).toBe(true);
    expect(findEdge(fx, 'import', `${SERVER}/live/service.ts`, `${CORE}/session.ts`)?.meta?.reexport).toBeUndefined();
  });

  it('incremental: editing core/src re-resolves dependents that import it by package name', async () => {
    fx = await index();
    const before = edgeStrings(fx, [...ALL_TYPES]);
    const session = join(fx.root, CORE, 'session.ts');
    const original = readFileSync(session, 'utf-8');

    // rename createSession → makeSession: server + web files (unchanged) must lose / re-point their edges
    writeFileSync(session, original.replace(/createSession/g, 'makeSession'));
    const run = await fx.reindex();
    expect(run.filesIndexed).toBeGreaterThanOrEqual(3);                 // session.ts + dependents
    expect(run.filesReresolved).toBeGreaterThanOrEqual(2);              // service.ts + +page.svelte at least
    expect(findEdge(fx, 'call', `${SERVER}/live/service.ts/LiveService.start`, `${CORE}/session.ts/createSession`)).toBeUndefined();
    expect(fx.unresolved.map((r) => `${r.type} ${r.target_name}`)).toEqual(expect.arrayContaining(['call createSession']));

    // restoring it heals both, and the graph equals a fresh index of the same tree
    writeFileSync(session, original);
    await fx.reindex();
    expect(fx.unresolved).toEqual([]);
    expect(edgeStrings(fx, [...ALL_TYPES])).toEqual(before);
    const fresh = await indexFixture(fx.root);
    expect(edgeStrings(fresh, [...ALL_TYPES])).toEqual(before);
    await fresh.cleanup();
  });

  it('incremental: a new file under a workspace package links importers that did not change', async () => {
    fx = await index();
    const main = join(fx.root, SERVER, 'main.ts');
    writeFileSync(main, `import { later } from '@scope/core/utils/later';\n${readFileSync(main, 'utf-8')}\nexport const x = later();\n`);
    await fx.reindex();
    expect(fx.unresolved.map((r) => r.target_name)).toContain('@scope/core/utils/later');

    writeFileSync(join(fx.root, CORE, 'utils/later.ts'), 'export function later(): number { return 1; }\n');
    await fx.reindex();
    expect(findEdge(fx, 'import', `${SERVER}/main.ts`, `${CORE}/utils/later.ts`)).toBeDefined();
    expect(fx.unresolved).toEqual([]);
  });
});
