/**
 * Map v2 / M4 scenarios, Focus mode: the layered fixture (enter and leave by button, key and breadcrumb,
 * depth / direction / types, Group-by, deep link with back / forward, a zone as focus, hover paths) and the
 * Halcyon copy (focus on packages/core/src/adapter.ts: depth 1 and 2 show its consumers across packages,
 * inside the viewport, no overlaps). Runs after the layers scenarios.
 */
import { join } from 'node:path';
import { assert, assertCleanLayout, settle } from './canvas-page.mjs';
import { openProjectMap, projectId } from './layers-scenarios.mjs';

async function shot(ctx, name) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `${name}.png`) });
}

const SERVICE = 'file:services/user-service.ts';
const card = (id) => `.react-flow__node[data-id="${id}"]`;
const hash = (page) => page.evaluate(() => window.location.hash);
const cardIds = (page) => page.$$eval('[data-testid="file-card"]', (els) => els.map((e) => e.closest('.react-flow__node').getAttribute('data-id')).sort());
const focusDeepLink = (id, target, query = '') => `#/p/${encodeURIComponent(id)}/map/focus/${encodeURIComponent(target)}${query}`;

async function enterFocusOn(ctx, id) {
  const { page } = ctx;
  await page.locator(card(id)).click();
  await page.click('[data-testid="focus-button"]');
  await page.waitForSelector('[data-testid="focus-bar"]');
  await settle(page);
}

export const focusScenarios = [
  {
    name: 'focus: button, breadcrumb, depth / direction / types, Escape back to the same view',
    async run(ctx) {
      const { page } = ctx;
      const id = await projectId(ctx.projects.layered.root);
      await openProjectMap(ctx, id);
      const before = await cardIds(page);
      assert(!(await page.locator('[data-testid="focus-bar"]').count()), 'no focus bar before');
      assert(await page.locator('[data-testid="focus-button"]').isDisabled(), 'Focus is disabled with nothing selected');
      await enterFocusOn(ctx, SERVICE);
      assert(/\/map\/focus\/services%2Fuser-service\.ts\?depth=2&dir=both/.test(await hash(page)), `deep link written: ${await hash(page)}`);
      assert((await page.textContent('[data-testid="crumb-focus"]')) === 'Focus: user-service.ts', 'breadcrumb ends with the focus');
      assert((await page.locator('[data-testid="file-card"][data-focus="true"]').count()) === 1, 'exactly one focused card');
      // depth 2 both: user-service, users.ts, health.ts, user-repo, and user-repo's other consumers admin.ts and audit.ts
      const d2 = await cardIds(page);
      assert(d2.length === 6 && d2.includes('file:routes/admin.ts') && d2.includes('file:data/user-repo.ts'), `depth 2 neighbourhood: ${d2}`);
      assert((await page.textContent('[data-testid="focus-accounting"]')).startsWith('6 cards'), 'accounting names the cards');
      await shot(ctx, '50-focus-layered-d2');
      // depth 1: the consumers of user-repo drop out; the replace keeps one history entry per focus
      const entries = await page.evaluate(() => history.length);
      await page.locator('[data-testid="focus-depth"]').fill('1');
      await settle(page);
      const d1 = await cardIds(page);
      assert(d1.length === 4 && !d1.includes('file:routes/admin.ts'), `depth 1 neighbourhood: ${d1}`);
      assert(/depth=1/.test(await hash(page)) && (await page.evaluate(() => history.length)) === entries, 'depth is in the link without a new history entry');
      assert(/\+\d/.test((await page.locator(`${card('file:data/user-repo.ts')} [data-testid="beyond-badge"]`).textContent()) ?? ''), 'a card with relations beyond the depth shows +N');
      // direction: who uses user-service
      await page.click('[data-testid="focus-dir-in"]');
      await settle(page);
      assert((await cardIds(page)).join() === ['file:routes/health.ts', 'file:routes/users.ts', SERVICE].sort().join(), `used by: ${await cardIds(page)}`);
      await page.click('[data-testid="focus-dir-out"]');
      await settle(page);
      assert((await cardIds(page)).join() === ['file:data/user-repo.ts', SERVICE].sort().join(), `uses: ${await cardIds(page)}`);
      // types: switching imports off leaves nothing to follow and says so
      await page.click('[data-testid="focus-type-import"]');
      await page.click('[data-testid="focus-type-call"]');
      await settle(page);
      assert((await cardIds(page)).length === 1 && /Nothing within/.test(await page.textContent('[data-testid="focus-notice"]')), 'no types matching: only the focus and a notice');
      assert(/\+\d+ other types/.test(await page.textContent('[data-testid="focus-accounting"]')), 'the relations of the switched-off type are counted');
      await page.click('[data-testid="focus-type-import"]');
      await page.click('[data-testid="focus-type-call"]');
      // edges carry their relation kind and count
      await page.click('[data-testid="focus-dir-both"]');
      await settle(page);
      assert((await page.locator('[data-testid="edge-label"]', { hasText: 'imports 1' }).count()) >= 1, 'edge labels name the relation kind with a count');
      // leave: Escape returns to the very view the map was on, and the URL to its drill-path link
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-testid="focus-bar"]', { state: 'detached' });
      await settle(page);
      assert((await cardIds(page)).join() === before.join(), 'the same cards as before focusing');
      assert(/\/map\/path\//.test(await hash(page)), `drill-path link restored: ${await hash(page)}`);
    },
  },
  {
    name: 'focus: key F, detail-panel button, context menu, double-click moves the focus, breadcrumb leaves',
    async run(ctx) {
      const { page } = ctx;
      await openProjectMap(ctx, await projectId(ctx.projects.layered.root));
      await page.locator(card(SERVICE)).click();
      await page.keyboard.press('f');
      await page.waitForSelector('[data-testid="focus-bar"]');
      await settle(page);
      assert((await page.textContent('[data-testid="focus-title"]')) === 'Focus: user-service.ts', 'F focuses the selected card');
      await page.dblclick(`${card('file:data/user-repo.ts')} [data-testid="file-card"], ${card('file:data/user-repo.ts')}`);
      await settle(page);
      assert((await page.textContent('[data-testid="focus-title"]')) === 'Focus: user-repo.ts', 'double-click on a neighbour refocuses on it');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-testid="focus-bar"]', { state: 'detached' });
      // detail panel
      await page.locator(card('file:routes/admin.ts')).click();
      await page.click('[data-testid="detail-focus"]');
      await page.waitForSelector('[data-testid="focus-bar"]');
      assert((await page.textContent('[data-testid="focus-title"]')) === 'Focus: admin.ts', 'the detail panel button focuses');
      // breadcrumb: an ancestor leaves focus and opens that container
      await page.locator('[data-testid="crumb"]', { hasText: 'routes' }).first().click();
      await page.waitForSelector('[data-testid="focus-bar"]', { state: 'detached' });
      // context menu
      await page.locator(card('file:routes/users.ts')).click({ button: 'right' });
      await page.click('[data-testid="zone-menu-focus"]');
      await page.waitForSelector('[data-testid="focus-bar"]');
      assert((await page.textContent('[data-testid="focus-title"]')) === 'Focus: users.ts', 'the context menu focuses');
      // Escape does not leave focus while the context menu owns it
      await page.locator(card('file:routes/users.ts')).click({ button: 'right' });
      await page.keyboard.press('Escape');
      assert((await page.locator('[data-testid="focus-bar"]').count()) === 1 && !(await page.locator('[data-testid="zone-menu"]').count()), 'Escape closes the menu first');
    },
  },
  {
    name: 'focus: a deep link opens it; back and forward walk in and out; Group-by layers shows frames and the rule break',
    async run(ctx) {
      const { page } = ctx;
      const id = await projectId(ctx.projects.layered.root);
      await openProjectMap(ctx, id, focusDeepLink(id, 'services/user-service.ts', '?depth=2&dir=out').replace(/^#\/p\/[^/]+\/map/, ''));
      await page.waitForSelector('[data-testid="focus-bar"]');
      await settle(page);
      assert((await page.textContent('[data-testid="focus-depth-value"]')) === '2', 'depth comes from the link');
      assert((await page.getAttribute('[data-testid="focus-dir-out"]', 'aria-pressed')) === 'true', 'direction comes from the link');
      assert((await cardIds(page)).join() === ['file:data/user-repo.ts', SERVICE].sort().join(), 'only what it uses');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-testid="focus-bar"]', { state: 'detached' });
      await page.goBack();
      await page.waitForSelector('[data-testid="focus-bar"]', { timeout: 15000 });
      assert(/depth=2&dir=out/.test(await hash(page)), 'back returns into the focus');
      await page.goForward();
      await page.waitForSelector('[data-testid="focus-bar"]', { state: 'detached', timeout: 15000 });
      // layers grouping inside focus: layer frames, and the Routes -> Data rule break between them
      await page.goBack();
      await page.waitForSelector('[data-testid="focus-bar"]');
      await page.locator('[data-testid="focus-depth"]').fill('3');
      await page.click('[data-testid="focus-dir-both"]');
      await page.click('[data-testid="group-by-layers"]');
      await page.waitForSelector('[data-testid="zone"][data-zone-id="zone:layers:Routes"]');
      await settle(page);
      for (const z of ['Routes', 'Services', 'Data']) assert((await page.locator(`[data-zone-id="zone:layers:${z}"][data-collapsed="false"]`).count()) === 1, `${z} frame in focus`);
      assert((await page.locator('[data-testid="edge-label"]', { hasText: 'rule break' }).count()) >= 1, 'the rule break is drawn between the layer frames');
      const red = await page.$$eval('path.react-flow__edge-path', (els) => els.filter((e) => getComputedStyle(e).strokeDasharray.startsWith('9') && /rgb\(220, 38, 38\)/.test(getComputedStyle(e).stroke)).length);
      assert(red >= 1, `a red dashed edge shows the Routes -> Data break: ${red}`);
      await assertCleanLayout(page, 'focus + layers');
      await shot(ctx, '51-focus-layers');
    },
  },
  {
    name: 'focus: a zone is one card in front of its neighbourhood',
    async run(ctx) {
      const { page } = ctx;
      await openProjectMap(ctx, await projectId(ctx.projects.layered.root));
      await page.click('[data-testid="group-by-layers"]');
      await page.waitForSelector('[data-testid="zone"][data-zone-id="zone:layers:Services"]');
      await settle(page);
      await page.locator('[data-zone-id="zone:layers:Services"] [data-testid="zone-chip"]').click({ button: 'right' });
      await page.click('[data-testid="zone-menu-focus"]');
      await page.waitForSelector('[data-testid="focus-bar"]');
      await settle(page);
      assert((await page.textContent('[data-testid="focus-title"]')).startsWith('Focus: Services'), 'the zone is the focus');
      assert((await page.locator('[data-testid="zone"][data-focus-role="focus"][data-collapsed="true"]').count()) === 1, 'one collapsed card stands for the zone');
      const ids = await cardIds(page);
      assert(ids.includes('file:routes/users.ts') && ids.includes('file:data/user-repo.ts') && !ids.includes(SERVICE), `its neighbours around it: ${ids}`);
      assert(/#\/p\/[^/]+\/map\/focus\/zone%3Alayers%3AServices/.test(await hash(page)), `zone id in the link: ${await hash(page)}`);
      await assertCleanLayout(page, 'zone focus');
      await shot(ctx, '52-focus-zone');
    },
  },
  {
    name: 'focus (Halcyon): adapter.ts depth 1 and 2 show its consumers across packages, in view, no overlaps, hover highlights paths',
    async run(ctx) {
      if (!ctx.projects.halcyon) return console.log('    (skipped: no Halcyon snapshot)');
      const { page } = ctx;
      const id = await projectId(ctx.projects.halcyon.root);
      await openProjectMap(ctx, id, focusDeepLink(id, 'packages/core/src/adapter.ts', '?depth=1&dir=both').replace(/^#\/p\/[^/]+\/map/, ''));
      await page.waitForSelector('[data-testid="focus-bar"]', { timeout: 30000 });
      await settle(page);
      const d1 = await cardIds(page);
      const packages = async () => page.$$eval('[data-testid="zone"][data-collapsed="false"] .fl-zone-name', (els) => els.map((e) => e.textContent).sort());
      const p1 = await packages();
      assert(d1.includes('file:packages/core/src/adapter.ts') && d1.length > 10, `depth 1 shows the consumers: ${d1.length} cards`);
      assert(p1.length >= 2, `consumers span packages: ${p1}`);
      assert((await page.locator('[data-testid="file-card"][data-focus="true"]').count()) === 1, 'the focused card is marked');
      await assertCleanLayout(page, 'halcyon depth 1');
      await shot(ctx, '53-focus-halcyon-d1');
      await page.locator('[data-testid="focus-depth"]').fill('2');
      await settle(page);
      const d2 = await cardIds(page);
      assert(d2.length > d1.length, `depth 2 shows more: ${d1.length} -> ${d2.length}`);
      assert((await page.locator('[data-zone-id^="zone:focus:more:"]').count()) >= 1, 'past the cap the rest folds into +N more cards');
      assert(/nearest/.test(await page.textContent('[data-testid="focus-notice"]')), 'and a notice says so');
      assert(d2.length <= 81, `at most the cap: ${d2.length}`);
      await assertCleanLayout(page, 'halcyon depth 2');
      await shot(ctx, '54-focus-halcyon-d2');
      // hover: a depth-2 card lights up the path to the focus and dims the rest
      const far = await page.$$eval('[data-testid="file-card"]', (els) => els.map((e) => e.closest('.react-flow__node').getAttribute('data-id')));
      let hot = 0;
      for (const target of far.slice(-12)) {
        await page.locator(card(target)).hover();
        await page.waitForTimeout(200);
        hot = await page.$$eval('.react-flow__edge-path', (els) => els.filter((e) => parseFloat(getComputedStyle(e).strokeWidth) >= 3.5).length);
        if (hot > 0) break;
      }
      assert(hot >= 1, 'hovering a card strengthens the edges on its path to the focus');
      await shot(ctx, '55-focus-halcyon-hover');
    },
  },
];
