/**
 * Map v2 / M1 scenarios on the deep monorepo fixture (test/canvas/helpers/deep-fixture.ts):
 * real hierarchy of arbitrary depth, full breadcrumb, portal edges with exact
 * counts, symbol-less files, muted Config group + lockfile toggle, back/forward,
 * deep links and fit-view after drilling three levels. Runs last because it
 * registers a fourth project with the daemon.
 */
import { join } from 'node:path';
import { apiConfig, apiJson, assert, edgeCount, layoutBoxes, nodeIds, settle, signIn } from './canvas-page.mjs';

async function shot(ctx, name) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `${name}.png`) });
}

async function registerDeep(ctx) {
  const { daemon, token } = apiConfig();
  const res = await fetch(`${daemon}/api/projects/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: ctx.projects.deep.root, register: true }),
  });
  return (await res.json()).id;
}

async function open(ctx, id, hash = '') {
  await signIn(ctx.page, ctx.base, `#/p/${encodeURIComponent(id)}/map${hash}`);
  await ctx.page.waitForSelector('[data-testid="map-view"] .react-flow__node', { timeout: 60000 });
  await settle(ctx.page);
}

const portalsOf = (page) =>
  page.$$eval('[data-testid="portal"]', (els) =>
    els.map((e) => ({ dir: e.getAttribute('data-direction'), target: e.getAttribute('data-target'), count: Number(e.getAttribute('data-count')) })),
  );

/** Double-click a zone by its chip (frames ignore pointer events elsewhere), a card or portal anywhere. */
async function dbl(page, id) {
  const chip = page.locator(`.react-flow__node[data-id="${id}"] [data-testid="zone-chip"]`);
  await ((await chip.count()) ? chip.first() : page.locator(`.react-flow__node[data-id="${id}"]`)).dblclick();
  await settle(page);
}

/** Every node box lies inside the flow pane. */
async function assertInViewport(page, label) {
  const { pane, nodes } = await layoutBoxes(page);
  assert(nodes.length > 0, `${label}: nodes rendered`);
  for (const n of nodes) {
    const inside = n.x >= pane.x - 1 && n.y >= pane.y - 1 && n.x + n.w <= pane.x + pane.w + 1 && n.y + n.h <= pane.y + pane.h + 1;
    assert(inside, `${label}: ${n.id} outside the viewport ${JSON.stringify(n)} pane ${JSON.stringify(pane)}`);
  }
  return nodes.length;
}

/** Non-contain relations from `fromPrefix` files into `toPrefix` files, per source file (exact, from the raw API). */
async function relationCounts(ctx, fromPrefix, toPrefix) {
  const [entities, relations] = await Promise.all([apiJson(ctx.deepApi, '/entities'), apiJson(ctx.deepApi, '/relations')]);
  const fileOf = new Map(entities.map((e) => [e.id, e.file]));
  const counts = {};
  for (const r of relations) {
    if (r.type === 'contain' || !r.to) continue;
    const from = fileOf.get(r.from);
    const to = fileOf.get(r.to);
    if (from?.startsWith(fromPrefix) && to?.startsWith(toPrefix)) counts[from] = (counts[from] ?? 0) + 1;
  }
  return counts;
}

async function prepare(ctx) {
  ctx.deepId = await registerDeep(ctx);
  ctx.deepApi = ctx.api.replace(ctx.projects.a.id, ctx.deepId);
}

const crumbTexts = (page) => page.$$eval('[data-testid="crumb"]', (els) => els.map((e) => e.textContent));

export const mapScenarios = [
  {
    name: 'map: three levels deep keeps the full breadcrumb, the nodes in the viewport and back/forward working',
    async run(ctx) {
      const { page } = ctx;
      await prepare(ctx);
      await open(ctx, ctx.deepId);
      // Default grouping is Packages: both workspace packages are frames (the plain `packages/` folder
      // that only holds packages is dissolved), the root Config group is a muted card.
      const root = await nodeIds(page);
      for (const id of ['package:packages/core', 'package:packages/web', 'config:.']) assert(root.includes(id), `root has ${id}: ${root}`);
      assert(!root.includes('folder:packages'), `a folder holding only packages is not a zone: ${root}`);
      assert(await page.locator('[data-testid="file-card"][data-parent="package:packages/core"]').count(), 'core frame holds file cards');
      await assertInViewport(page, 'root');
      await shot(ctx, '20-deep-root');

      assert((await edgeCount(page)) >= 1, 'web → core bundle between the package frames');
      const labels = await page.$$eval('[data-testid="edge-label"]', (els) => els.map((e) => e.textContent));
      assert(labels.some((l) => /imports \d+/.test(l) && /calls \d+/.test(l)), `a bundled edge label names the kinds: ${labels}`);
      await shot(ctx, '21-deep-packages');

      await dbl(page, 'package:packages/core');
      await assertInViewport(page, 'core package');
      await dbl(page, 'folder:packages/core/src');
      await assertInViewport(page, 'core/src');
      await dbl(page, 'folder:packages/core/src/domain/billing');
      const ids = await nodeIds(page);
      assert(ids.includes('folder:packages/core/src/domain/billing/invoices'), `3 levels deep: ${ids}`);
      assert(ids.includes('file:packages/core/src/domain/billing/receipt.ts'), `file next to the folder: ${ids}`);
      assert(!ids.includes('folder:packages/core/src/domain'), 'single-child chain domain/billing is collapsed into one box');
      assert((await assertInViewport(page, 'billing')) === ids.length, 'all nodes in the viewport after 4 drills');
      assert((await crumbTexts(page)).join(' / ') === 'deep-app / packages / @deep/core / src / domain/billing', `breadcrumb: ${await crumbTexts(page)}`);
      await shot(ctx, '22-deep-billing');

      // Click a middle crumb, then browser back returns to the deep level.
      await page.locator('[data-testid="crumb"]', { hasText: '@deep/core' }).click();
      await settle(page);
      assert((await nodeIds(page)).includes('folder:packages/core/src'), 'crumb opens the package');
      await assertInViewport(page, 'after crumb');
      await page.goBack();
      await settle(page);
      assert((await crumbTexts(page)).pop() === 'domain/billing', `back returns to billing: ${await crumbTexts(page)}`);
      await assertInViewport(page, 'after back');
      await page.goBack();
      await settle(page);
      assert((await crumbTexts(page)).pop() === 'src', 'back again returns to src');
      await page.goForward();
      await settle(page);
      assert((await crumbTexts(page)).pop() === 'domain/billing', 'forward returns to billing');
      await assertInViewport(page, 'after forward');
    },
  },
  {
    name: 'map: portal stubs carry exact counts per direction and open their target container',
    async run(ctx) {
      const { page } = ctx;
      await prepare(ctx);
      await open(ctx, ctx.deepId, '/path/packages/core/src/domain/billing');
      const expected = await relationCounts(ctx, 'packages/web/', 'packages/core/');
      const total = Object.values(expected).reduce((a, b) => a + b, 0);
      assert(total > 0, 'fixture has web → core relations');
      const portals = await portalsOf(page);
      const fromWeb = portals.filter((p) => p.dir === 'in' && p.target.startsWith('file:packages/web') || p.dir === 'in' && p.target.startsWith('folder:packages/web') || p.dir === 'in' && p.target.startsWith('package:packages/web'));
      assert(fromWeb.reduce((a, p) => a + p.count, 0) === total, `incoming from web: ${JSON.stringify(portals)} vs ${JSON.stringify(expected)}`);
      const app = portals.find((p) => p.target === 'file:packages/web/src/app.ts');
      assert(app && app.count === expected['packages/web/src/app.ts'], `app.ts portal count ${app?.count} vs ${expected['packages/web/src/app.ts']}`);
      const inner = portals.find((p) => p.target === 'file:packages/core/src/index.ts');
      assert(inner && inner.dir === 'in', `index.ts re-exports into billing: ${JSON.stringify(portals)}`);
      const portalText = await page.locator('[data-testid="portal"]').first().textContent();
      assert(/imports|calls/.test(portalText), `portal shows the relation-kind breakdown: ${portalText}`);
      await assertInViewport(page, 'billing portals');
      await shot(ctx, '23-deep-portals');

      // Clicking the portal opens the container it stands for.
      await page.locator('[data-testid="portal"][data-target="file:packages/web/src/app.ts"]').click();
      await settle(page);
      assert((await crumbTexts(page)).pop() === 'app.ts', `portal opens app.ts: ${await crumbTexts(page)}`);
      const out = await portalsOf(page);
      assert(out.some((p) => p.dir === 'out' && p.target.includes('packages/core')), `app.ts has outgoing portals to core: ${JSON.stringify(out)}`);
      const outTotal = out.filter((p) => p.dir === 'out' && p.target.includes('packages/core')).reduce((a, p) => a + p.count, 0);
      assert(outTotal === total, `outgoing counts add up to ${total}: ${JSON.stringify(out)}`);
      await shot(ctx, '24-deep-portal-out');
    },
  },
  {
    name: 'map: symbol-less file, Config group and lockfile toggle',
    async run(ctx) {
      const { page } = ctx;
      await prepare(ctx);
      await open(ctx, ctx.deepId, '/path/packages/web/src');
      const ids = await nodeIds(page);
      assert(ids.includes('file:packages/web/src/side-effects.ts'), `file without symbols is visible: ${ids}`);
      assert(ids.includes('file:packages/web/src/app.ts') && ids.includes('folder:packages/web/src/pages'), `web/src: ${ids}`);
      await shot(ctx, '25-deep-web-src');

      await open(ctx, ctx.deepId, '/path/.');
      await dbl(page, 'config:.');
      let cfg = await nodeIds(page);
      assert(cfg.includes('file:package.json') && cfg.includes('file:tsconfig.json'), `config files listed: ${cfg}`);
      assert(!cfg.includes('file:pnpm-lock.yaml'), 'lockfile hidden by default');
      await page.locator('button', { hasText: 'Relations' }).click();
      await page.locator('[data-testid="show-lockfiles"]').check();
      await settle(page);
      cfg = await nodeIds(page);
      assert(cfg.includes('file:pnpm-lock.yaml'), `lockfile shown after the toggle: ${cfg}`);
      await assertInViewport(page, 'config group');
      await shot(ctx, '26-deep-config');
    },
  },
  {
    name: 'map: deep link to a nested folder, then detail panel shows reference lines and editor links',
    async run(ctx) {
      const { page } = ctx;
      await prepare(ctx);
      await open(ctx, ctx.deepId, '/path/packages/core/src/domain/billing/invoices');
      const ids = await nodeIds(page);
      assert(ids.includes('file:packages/core/src/domain/billing/invoices/calc.ts'), `deep link opened invoices: ${ids}`);
      assert((await crumbTexts(page)).pop() === 'invoices', `crumbs: ${await crumbTexts(page)}`);
      await assertInViewport(page, 'deep link');
      await shot(ctx, '27-deep-link');

      await dbl(page, 'file:packages/core/src/domain/billing/invoices/calc.ts');
      const symbols = (await nodeIds(page)).filter((i) => !i.includes(':') || i.startsWith('portal:'));
      assert(symbols.some((i) => !i.startsWith('portal:')), `symbols of calc.ts: ${symbols}`);
      const totalNode = ctx.page.locator('.react-flow__node').filter({ hasText: /^.*total/ }).first();
      await totalNode.click();
      await page.waitForSelector('[data-testid="detail-panel"]');
      const link = await page.getAttribute('[data-testid="open-in-editor"]', 'href');
      assert(/^vscode:\/\/file\/.+calc\.ts:\d+/.test(link), `editor link: ${link}`);
      await page.selectOption('[data-testid="editor-scheme"]', 'cursor');
      assert((await page.getAttribute('[data-testid="open-in-editor"]', 'href')).startsWith('cursor://file/'), 'scheme switch');
      await shot(ctx, '28-deep-detail');
    },
  },
];
