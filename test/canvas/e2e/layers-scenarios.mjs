/**
 * Map v2 / M4 scenarios, Layers grouping: the layered-project fixture (Routes -> Services -> Data with one
 * deliberate Routes -> Data rule break) shows one frame per layer in declaration order, the rule break as a
 * red dashed edge between the frames and a marker on the offending card; a project without rules shows the
 * empty state and the rules editor can suggest a first set. Runs after the zone scenarios.
 */
import { join } from 'node:path';
import { apiConfig, assert, assertCleanLayout, settle, signIn } from './canvas-page.mjs';

async function shot(ctx, name) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `${name}.png`) });
}

export async function projectId(root) {
  const { daemon, token } = apiConfig();
  const res = await fetch(`${daemon}/api/projects/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, register: true }),
  });
  return (await res.json()).id;
}

export async function openProjectMap(ctx, id, hash = '') {
  await signIn(ctx.page, ctx.base, `#/p/${encodeURIComponent(id)}/map${hash}`);
  await ctx.page.waitForSelector('[data-testid="map-view"] .react-flow__node', { timeout: 60000 });
  await settle(ctx.page);
}

const zoneBox = (page, zoneId) =>
  page.$eval(`[data-testid="zone"][data-zone-id="${zoneId}"]`, (el) => el.closest('.react-flow__node').getBoundingClientRect().toJSON());

export const layersScenarios = [
  {
    name: 'layers: one frame per layer in declaration order, Unassigned collapsed, tooltip shows the rules',
    async run(ctx) {
      const { page } = ctx;
      await openProjectMap(ctx, await projectId(ctx.projects.layered.root));
      await page.click('[data-testid="group-by-layers"]');
      await page.waitForSelector('[data-testid="zone"][data-zone-id="zone:layers:Routes"]');
      await settle(page);
      const ids = ['zone:layers:Routes', 'zone:layers:Services', 'zone:layers:Data'];
      const boxes = [];
      for (const id of ids) {
        assert((await page.locator(`[data-zone-id="${id}"][data-collapsed="false"]`).count()) === 1, `${id} is an open frame`);
        boxes.push(await zoneBox(page, id));
      }
      assert(boxes[0].y < boxes[1].y && boxes[1].y < boxes[2].y, `top to bottom in declaration order: ${boxes.map((b) => Math.round(b.y))}`);
      const un = page.locator('[data-zone-id="zone:layers:<unassigned>"]');
      assert((await un.getAttribute('data-collapsed')) === 'true', 'Unassigned starts collapsed');
      assert((await un.getAttribute('data-source')) === 'config', 'Unassigned is the muted bucket');
      const title = await page.locator('[data-zone-id="zone:layers:Routes"] [data-testid="zone-chip"]').getAttribute('title');
      assert(/May only access: Services/.test(title), `chip tooltip: ${title}`);
      await assertCleanLayout(page, 'layers');
      await shot(ctx, '40-layers');
      await page.emulateMedia({ colorScheme: 'dark' });
      await settle(page);
      await assertCleanLayout(page, 'layers (dark)');
      await shot(ctx, '41-layers-dark');
    },
  },
  {
    name: 'layers: the rule break is a red dashed edge between frames with a count; the offending card is marked; click lists it',
    async run(ctx) {
      const { page } = ctx;
      await openProjectMap(ctx, await projectId(ctx.projects.layered.root));
      await page.click('[data-testid="group-by-layers"]');
      await page.waitForSelector('[data-testid="zone"][data-zone-id="zone:layers:Routes"]');
      await settle(page);
      await page.waitForSelector('[data-testid="edge-label"]:text("rule break")');
      const violationEdges = await page.$$eval('[data-testid^="rf__edge-"] path.react-flow__edge-path', (els) =>
        els.filter((e) => getComputedStyle(e).strokeDasharray.startsWith('9') && /rgb\(220, 38, 38\)/.test(getComputedStyle(e).stroke)).length);
      assert(violationEdges >= 1, `a red dashed (9 4) edge is drawn: ${violationEdges}`);
      const marked = await page.$$eval('[data-testid="file-card"]', (els) => els.filter((e) => e.querySelector('[data-overlay^="violations"]')).map((e) => e.closest('.react-flow__node').getAttribute('data-id')));
      assert(marked.length === 1 && marked[0] === 'file:routes/admin.ts', `only the offending card is marked: ${marked}`);
      assert((await page.locator('[data-zone-id="zone:layers:Routes"] [data-testid="zone-breaks"]').textContent()).includes('2'), 'Routes chip counts its rule breaks');
      assert((await page.locator('[data-zone-id="zone:layers:Services"] [data-testid="zone-breaks"]').count()) === 0, 'Services has none');
      await page.locator('[data-testid="edge-label"]', { hasText: 'rule break' }).first().click();
      await page.waitForSelector('[data-testid="edge-detail-title"]');
      assert(/2 rule breaks/.test(await page.textContent('[data-testid="edge-detail-title"]')), 'detail panel names the rule breaks');
      assert(/may only access 'Services'/.test(await page.textContent('[data-testid="edge-rule"]')), 'and the rule');
      const lines = await page.locator('[data-testid="relation-lines"]').textContent();
      assert(/routes\/admin\.ts:5/.test(lines) && /routes\/admin\.ts:2/.test(lines), `violating relations are listed with their lines: ${lines}`);
      await shot(ctx, '42-layers-violation');
    },
  },
  {
    name: 'layers: without architecture.json the toolbar says so, Rules can suggest layers, saving brings the frames',
    async run(ctx) {
      const { page } = ctx;
      await openProjectMap(ctx, await projectId(ctx.projects.deep.root));
      await page.click('[data-testid="group-by-layers"]');
      await page.waitForSelector('[data-testid="layers-empty"]');
      assert(/No layers defined/.test(await page.textContent('[data-testid="layers-empty"]')), 'empty state text');
      assert(/showing folders/.test(await page.textContent('[data-testid="zone-notice"]')), 'the map falls back to folders and says so');
      await page.click('[data-testid="layers-empty-open"]');
      await page.waitForSelector('[data-testid="rules-editor"]');
      await page.click('[data-testid="rules-suggest"]');
      await page.waitForSelector('[data-testid="rules-editor"] input[value="Application"], [data-testid="rules-editor"] input[value="Packages"]');
      await page.click('[data-testid="rules-save"]');
      await page.waitForSelector('[data-testid="layers-empty"]', { state: 'detached', timeout: 20000 });
      await settle(page);
      assert((await page.locator('[data-testid="zone"][data-zone-id^="zone:layers:"]').count()) >= 1, 'layer frames appear after saving');
      await shot(ctx, '43-layers-suggested');
    },
  },
];
