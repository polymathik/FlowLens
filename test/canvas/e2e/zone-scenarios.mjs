/**
 * Map v2 / M2 scenarios: zones drawn as frames on the deep monorepo fixture.
 * Frames contain their cards, no card sits outside its zone, frames never
 * overlap, everything is in the viewport after fit (light and dark); the chip
 * collapses / expands a zone; Group by switches the zoning; the context menu
 * writes overrides (zones.json route mocked) and rolls back with a notice.
 * Runs after the map scenarios (the deep project is registered there).
 */
import { join } from 'node:path';
import { apiConfig, assert, assertCleanLayout, nodeIds, settle, signIn } from './canvas-page.mjs';

async function shot(ctx, name) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `${name}.png`) });
}

async function deepId(ctx) {
  const { daemon, token } = apiConfig();
  const res = await fetch(`${daemon}/api/projects/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: ctx.projects.deep.root, register: true }),
  });
  return (await res.json()).id;
}

async function openMap(ctx, id, hash = '') {
  await signIn(ctx.page, ctx.base, `#/p/${encodeURIComponent(id)}/map${hash}`);
  await ctx.page.waitForSelector('[data-testid="map-view"] .react-flow__node', { timeout: 60000 });
  await settle(ctx.page);
}

/** Frames (expanded zones) and file cards with their on-screen boxes. */
const boxes = (page) =>
  page.evaluate(() => {
    const box = (el) => el.closest('.react-flow__node').getBoundingClientRect().toJSON();
    const frames = [...document.querySelectorAll('[data-testid="zone"][data-collapsed="false"]')].map((el) => ({ id: el.closest('.react-flow__node').getAttribute('data-id'), ...box(el) }));
    const cards = [...document.querySelectorAll('[data-testid="file-card"]')].map((el) => ({ id: el.closest('.react-flow__node').getAttribute('data-id'), parent: el.getAttribute('data-parent'), ...box(el) }));
    return { frames, cards };
  });

async function assertFramesHoldTheirCards(page, label) {
  const { frames, cards } = await boxes(page);
  assert(frames.length >= 2 && cards.length >= 5, `${label}: ${frames.length} frames, ${cards.length} cards`);
  const byId = new Map(frames.map((f) => [f.id, f]));
  for (const c of cards) {
    if (!c.parent) continue;
    const f = byId.get(c.parent);
    assert(f, `${label}: card ${c.id} has no frame ${c.parent}`);
    assert(c.x >= f.x - 1 && c.y >= f.y - 1 && c.right <= f.right + 1 && c.bottom <= f.bottom + 1, `${label}: card ${c.id} sticks out of ${f.id}`);
  }
  await assertCleanLayout(page, label); // in the viewport, only nested boxes overlap
}

const crumbTexts = (page) => page.$$eval('[data-testid="crumb"]', (els) => els.map((e) => e.textContent));

export const zoneScenarios = [
  {
    name: 'zones: frames contain their cards, nothing overlaps, in the viewport (light and dark)',
    async run(ctx) {
      const { page } = ctx;
      await openMap(ctx, await deepId(ctx));
      await assertFramesHoldTheirCards(page, 'light');
      await shot(ctx, '30-zones-light');
      await page.emulateMedia({ colorScheme: 'dark' });
      await settle(page);
      await assertFramesHoldTheirCards(page, 'dark');
      const hue = await page.$eval('[data-testid="zone"][data-collapsed="false"]', (el) => getComputedStyle(el).borderTopColor);
      assert(hue && hue !== 'rgba(0, 0, 0, 0)', `frame border is coloured in dark mode: ${hue}`);
      await shot(ctx, '31-zones-dark');
      // Opening a zone keeps the invariants one level down.
      await page.locator('.react-flow__node[data-id="package:packages/core"] [data-testid="zone-chip"]').dblclick();
      await settle(page);
      await assertFramesHoldTheirCards(page, 'core package').catch(async (err) => {
        // A package with a single nested zone has one frame: only the viewport / overlap rules apply.
        if (!/frames/.test(String(err))) throw err;
        await assertCleanLayout(page, 'core package');
      });
      assert((await crumbTexts(page)).pop() === '@deep/core', `crumb: ${await crumbTexts(page)}`);
    },
  },
  {
    name: 'zones: the chip collapses and expands a zone; Group by folders re-groups',
    async run(ctx) {
      const { page } = ctx;
      await openMap(ctx, await deepId(ctx));
      const frame = '.react-flow__node[data-id="package:packages/web"]';
      const cards = '[data-testid="file-card"][data-parent="package:packages/web"]';
      const before = await page.locator(cards).count();
      assert(before > 0, 'web frame holds cards');
      await page.locator(`${frame} [data-testid="zone-chip"]`).click();
      await page.waitForSelector(`${frame} [data-testid="zone"][data-collapsed="true"]`);
      await settle(page);
      assert((await page.locator(cards).count()) === 0, 'collapsed zone shows no cards of its own');
      assert(/\d+ files?/.test(await page.textContent(frame)), `collapsed card still counts its files: ${await page.textContent(frame)}`);
      await shot(ctx, '32-zone-collapsed');
      await page.locator(`${frame} [data-testid="zone-chip"]`).click();
      await page.waitForSelector(`${frame} [data-testid="zone"][data-collapsed="false"]`);
      await settle(page);
      assert((await page.locator(cards).count()) === before, 'expanding brings the cards back');

      await page.locator('[data-testid="collapse-all"]').click();
      await settle(page);
      assert((await page.locator('[data-testid="file-card"]').count()) === 0 || (await page.locator('[data-testid="zone"][data-collapsed="false"]').count()) === 0, 'Collapse all leaves only zone cards');
      await page.locator('[data-testid="expand-all"]').click();
      await settle(page);
      assert((await page.locator('[data-testid="file-card"]').count()) >= before, 'Expand all opens the zones again');

      await page.locator('[data-testid="group-by-folders"]').click();
      await settle(page);
      assert((await nodeIds(page)).includes('folder:packages'), `Folders grouping nests like the directory tree: ${await nodeIds(page)}`);
      await assertCleanLayout(page, 'folders grouping');
      await shot(ctx, '33-group-folders');
    },
  },
  {
    name: 'zones: right-click renames a zone (persisted), a failed save is undone with a notice',
    async run(ctx) {
      const { page } = ctx;
      const puts = [];
      let failNext = false;
      await page.route('**/canvas/zones', async (route) => {
        const req = route.request();
        if (req.method() === 'GET') return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
        if (failNext) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"disk full"}' });
        puts.push(JSON.parse(req.postData() ?? '{}'));
        return route.fulfill({ status: 200, contentType: 'application/json', body: req.postData() ?? '{}' });
      });
      await openMap(ctx, await deepId(ctx));
      const chip = '.react-flow__node[data-id="package:packages/core"] [data-testid="zone-chip"]';
      const rename = async (to) => {
        await page.locator(chip).click({ button: 'right' });
        await page.click('[data-testid="zone-menu-rename"]');
        await page.fill('[data-testid="zone-rename-input"]', to);
        await page.press('[data-testid="zone-rename-input"]', 'Enter');
      };
      await rename('Core lib');
      await page.waitForFunction((sel) => document.querySelector(sel)?.textContent?.includes('Core lib'), chip);
      await settle(page);
      assert(puts.length === 1, `one PUT: ${puts.length}`);
      const [ref, ov] = Object.entries(puts[0].zones)[0];
      assert(ref.startsWith('packages:') && ov.name === 'Core lib', `override stored by mode:key: ${JSON.stringify(puts[0])}`);
      await shot(ctx, '34-zone-renamed');

      failNext = true;
      await rename('Broken');
      await page.waitForSelector('[data-testid="zone-notice"]');
      assert(/undone/i.test(await page.textContent('[data-testid="zone-notice"]')), 'notice says the change was undone');
      assert((await page.textContent(chip)).includes('Core lib') && !(await page.textContent(chip)).includes('Broken'), 'the name is rolled back');
      await shot(ctx, '35-zone-save-failed');
    },
  },
];
