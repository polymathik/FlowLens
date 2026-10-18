/**
 * Canvas E2E scenarios against the indexed sample-app fixture:
 *   src/{core,api,ui}, lib/util; api → ui is a rule break; ui/view ↔ ui/widgets is a cycle.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  apiJson,
  assert,
  assertCleanLayout,
  clickNode,
  dblclickNode,
  edgeCount,
  nodeIds,
  nodeOverlay,
  openCanvas,
  pngStats,
  settle,
} from './canvas-page.mjs';

async function selectOverlay(page, value) {
  await page.selectOption('[data-testid="overlay-select"]', value);
  await page.waitForTimeout(400);
}

async function shot(ctx, name) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `${name}.png`) });
}

export const scenarios = [
  {
    name: 'root view shows the real top-level folders with child counts and edges',
    async run(ctx) {
      const { page, base } = ctx;
      await openCanvas(page, base);
      const ids = await nodeIds(page);
      assert(ids.includes('folder:src') && ids.includes('folder:lib/util'), `root nodes: ${ids}`);
      assert(ids.every((id) => id.startsWith('folder:') || id.startsWith('file:')), `only hierarchy boxes at root: ${ids}`);
      assert((await edgeCount(page)) >= 1, 'src → lib/util import edge rendered');
      await assertCleanLayout(page, 'root view');
      // Zones are frames: the chip names the zone and counts every file below it, the cards sit inside the frame.
      const chip = await page.textContent('.react-flow__node[data-id="folder:src"] [data-testid="zone-chip"]');
      assert(/src/.test(chip) && /7/.test(chip), `src chip shows its name and file count: ${chip}`);
      const frame = await page.locator('.react-flow__node[data-id="folder:src"]').boundingBox();
      const cards = await page.$$eval('[data-testid="file-card"][data-parent="folder:src"]', (els) => els.map((e) => e.closest('.react-flow__node').getBoundingClientRect().toJSON()));
      assert(cards.length > 0, 'src frame holds file cards');
      assert(cards.every((c) => c.x >= frame.x - 1 && c.y >= frame.y - 1 && c.right <= frame.x + frame.width + 1 && c.bottom <= frame.y + frame.height + 1), 'every card of src lies inside the src frame');
      await page.waitForSelector('[data-testid="stat-strip"]');
      const files = await page.textContent('[data-testid="stat-files"]');
      assert(files.includes('9'), `stat strip files: ${files}`);
      await shot(ctx, '01-root');
    },
  },
  {
    name: 'drill root → folder → folder shows only the open container plus portals; crumbs navigate',
    async run(ctx) {
      const { page, base } = ctx;
      await openCanvas(page, base);
      await dblclickNode(page, 'folder:src');
      let ids = await nodeIds(page);
      for (const m of ['folder:src/api', 'folder:src/core', 'folder:src/ui', 'file:src/index.ts']) {
        assert(ids.includes(m), `src view has ${m}: ${ids}`);
      }
      assert(!ids.includes('folder:src'), 'open container is not drawn as a box');
      assert(!ids.includes('folder:lib/util') || ids.some((i) => i.startsWith('portal:')), 'lib/util only as a portal');
      assert((await edgeCount(page)) >= 2, 'sibling edges in src view');
      await assertCleanLayout(page, 'src view');
      await shot(ctx, '02-src');

      await dblclickNode(page, 'folder:src/api');
      ids = await nodeIds(page);
      assert(ids.includes('file:src/api/routes.ts') && ids.includes('file:src/api/handlers.ts'), `api files: ${ids}`);
      assert(!ids.includes('folder:src/ui') && !ids.includes('folder:src/api'), `no sibling boxes, only children: ${ids}`);
      const portals = await page.$$eval('[data-testid="portal"]', (els) =>
        els.map((e) => ({ dir: e.getAttribute('data-direction'), target: e.getAttribute('data-target'), count: e.getAttribute('data-count') })),
      );
      assert(portals.some((p) => p.dir === 'out' && p.target.includes('src/ui')), `outgoing portal to ui: ${JSON.stringify(portals)}`);
      assert(portals.every((p) => Number(p.count) > 0), 'portal counts are positive');
      await assertCleanLayout(page, 'api view');
      await shot(ctx, '03-api');

      const crumbs = await page.$$eval('[data-testid="crumb"]', (els) => els.map((e) => e.textContent));
      assert(crumbs.join('/') === 'sample-app/src/api' || (crumbs.includes('src') && crumbs.includes('api')), `full path crumbs: ${crumbs}`);
      const [toolbarBox, crumbBox] = await Promise.all([
        page.locator('[role="toolbar"]').boundingBox(),
        page.locator('[data-testid="breadcrumb"]').boundingBox(),
      ]);
      assert(crumbBox.y >= toolbarBox.y + toolbarBox.height - 1, 'breadcrumb sits below the toolbar');

      // Click the 'src' crumb → back to the src view.
      await page.locator('[data-testid="crumb"]', { hasText: /^src$/ }).click();
      await settle(page);
      assert((await nodeIds(page)).includes('folder:src/ui'), 'crumb navigates to src');
      await dblclickNode(page, 'folder:src/ui');
      ids = await nodeIds(page);
      assert(ids.includes('file:src/ui/view.ts') && !ids.includes('folder:src/api'), `ui view: ${ids}`);
      const crumb2 = await page.textContent('[data-testid="breadcrumb"]');
      assert(crumb2.includes('ui') && !crumb2.includes('api'), `path replaced: ${crumb2}`);

      await dblclickNode(page, 'file:src/ui/view.ts');
      ids = await nodeIds(page);
      assert(ids.length >= 2 && ids.some((id) => !id.includes(':')), `symbols of view.ts: ${ids}`);
      await assertCleanLayout(page, 'file view');
      assert((await page.textContent('[data-testid="breadcrumb"]')).includes('view.ts'), 'breadcrumb ends at file');
      await shot(ctx, '04-file');

      // Browser back returns to the ui folder, forward to the file.
      await page.goBack();
      await settle(page);
      assert((await nodeIds(page)).includes('file:src/ui/view.ts'), 'back returns to the ui folder');
      await page.goForward();
      await settle(page);
      assert((await page.textContent('[data-testid="breadcrumb"]')).includes('view.ts'), 'forward returns to the file');
    },
  },
  {
    name: 'search jump drills, selects and centres the symbol',
    async run(ctx) {
      const { page, base, api } = ctx;
      await openCanvas(page, base);
      const entities = await apiJson(api, '/entities');
      const target = entities.find((e) => e.name === 'renderUser');
      await page.click('[data-testid="search-button"]');
      await page.fill('[data-testid="search-input"]', 'rndrUsr');
      await page.waitForSelector('[data-testid="search-result"]');
      const first = await page.getAttribute('[data-testid="search-result"]', 'data-entity-id');
      assert(first === target.id, `fuzzy top hit is renderUser (${first})`);
      await page.keyboard.press('Enter');
      await page.waitForSelector(`.react-flow__node[data-id="${target.id}"]`);
      await settle(page);
      const sel = await page.getAttribute(`.react-flow__node[data-id="${target.id}"] .flowlens-node`, 'data-selected');
      assert(sel === 'true', 'jumped symbol is selected');
      const box = await page.locator(`.react-flow__node[data-id="${target.id}"]`).boundingBox();
      const pane = await page.locator('.react-flow').boundingBox();
      const cx = box.x + box.width / 2 - (pane.x + pane.width / 2);
      const cy = box.y + box.height / 2 - (pane.y + pane.height / 2);
      assert(Math.abs(cx) < 40 && Math.abs(cy) < 40, `symbol centred (offset ${cx.toFixed(0)},${cy.toFixed(0)})`);
      assert((await page.textContent('[data-testid="breadcrumb"]')).includes('view.ts'), 'breadcrumb shows the file');
      await page.waitForSelector('[data-testid="detail-panel"]');
      await shot(ctx, '05-search');
    },
  },
  {
    name: 'overlays change node styles; cycle and rule-break edges use their types',
    async run(ctx) {
      const { page, base, hasGit } = ctx;
      await openCanvas(page, base);
      await dblclickNode(page, 'folder:src');
      const plain = await nodeOverlay(page, 'folder:src/core');
      assert(plain.tag === '', 'no overlay tag by default');

      await selectOverlay(page, 'complexity-heatmap');
      const cx = await nodeOverlay(page, 'folder:src/core');
      assert(cx.tag.startsWith('complexity') && cx.border !== plain.border, `complexity styles ${JSON.stringify(cx)}`);
      await page.waitForSelector('[data-testid="overlay-legend"]');

      if (hasGit) {
        await selectOverlay(page, 'churn-heatmap');
        const churn = await nodeOverlay(page, 'folder:src/core');
        assert(churn.tag === 'churn', `core has churn ${JSON.stringify(churn)}`);
        await selectOverlay(page, 'hotspot');
        const hot = await nodeOverlay(page, 'folder:src/core');
        assert(hot.tag === 'hotspot', `core is a hotspot ${JSON.stringify(hot)}`);
      }

      await selectOverlay(page, 'architecture-violations');
      await page.waitForSelector('.react-flow__edge-violation', { timeout: 5000 });
      assert((await nodeOverlay(page, 'folder:src/api')).tag === 'violations', 'api module flagged');
      await shot(ctx, '06-violations');

      await selectOverlay(page, 'cycles');
      assert((await nodeOverlay(page, 'folder:src/ui')).tag === 'cycles', 'ui module contains a cycle');
      await dblclickNode(page, 'folder:src/ui');
      await page.waitForSelector('.react-flow__edge-cycle', { timeout: 5000 });
      assert((await edgeCount(page, '.react-flow__edge-cycle')) >= 2, 'both cycle edges use CycleEdge');
      await shot(ctx, '07-cycles');
    },
  },
  {
    name: 'PNG and SVG export are not blank',
    async run(ctx) {
      const { page, base } = ctx;
      await openCanvas(page, base);
      await dblclickNode(page, 'folder:src');
      const [png] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="export-png"]')]);
      const pngPath = await png.path();
      const stats = await pngStats(page, (await readFile(pngPath)).toString('base64'));
      assert(stats.width >= 640 && stats.height >= 400, `png size ${stats.width}x${stats.height}`);
      assert(stats.std > 8 && stats.nonWhiteRatio > 0.01, `png has content ${JSON.stringify(stats)}`);
      const [svg] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="export-svg"]')]);
      const rawSvg = await readFile(await svg.path(), 'utf-8');
      const svgText = rawSvg.startsWith('data:') ? decodeURIComponent(rawSvg.replace(/^data:[^,]*,/, '')) : rawSvg;
      assert(svgText.includes('<svg') && svgText.includes('foreignObject'), 'svg wraps HTML in foreignObject');
      assert(svgText.includes('core/') && svgText.includes('api/'), 'svg contains node labels');
      ctx.exportStats = stats;
    },
  },
  {
    name: 'deep link selects the symbol and applies the overlay; hashchange re-navigates',
    async run(ctx) {
      const { page, base, api } = ctx;
      const entities = await apiJson(api, '/entities');
      const store = entities.find((e) => e.name === 'UserStore');
      await openCanvas(page, base, `#/entity/${encodeURIComponent(store.qualified_name)}?overlay=complexity`);
      await page.waitForSelector(`.react-flow__node[data-id="${store.id}"] .flowlens-node[data-selected="true"]`);
      assert((await page.inputValue('[data-testid="overlay-select"]')) === 'complexity-heatmap', 'overlay from link');
      assert((await page.textContent('[data-testid="breadcrumb"]')).includes('store.ts'), 'drilled to store.ts');

      await page.evaluate((id) => (window.location.hash = `#/p/${id}/file/src%2Fui%2Fwidgets.ts`), ctx.projects.a.id);
      await page.waitForSelector('.react-flow__node[data-id="file:src/ui/widgets.ts"] .flowlens-node[data-selected="true"]');
      await settle(page);
      await shot(ctx, '08-deeplink');
    },
  },
  {
    name: 'rules editor keeps commas in patterns and previews violations live',
    async run(ctx) {
      const { page, base } = ctx;
      await openCanvas(page, base);
      await page.click('[data-testid="rules-button"]');
      await page.waitForSelector('[data-testid="layer-card"]');
      // api → ui: routes.ts→ui/view.ts import plus the cross-file handleGetUser→renderUser call.
      await page.waitForFunction(() => document.querySelector('[data-testid="rules-violation-count"]')?.textContent === '2');
      // Remove the api → ui ban: preview drops to 0 without saving.
      const apiCard = page.locator('[data-testid="layer-card"]').nth(1);
      await apiCard.locator('[data-testid="must-not"] button', { hasText: 'ui' }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="rules-violation-count"]')?.textContent === '0');
      const patternInput = apiCard.locator('[data-testid="pattern-input"] input');
      await patternInput.fill('src/{api,routes}/**');
      await patternInput.press('Enter');
      const chips = await apiCard.locator('[data-testid="chip"]').allTextContents();
      assert(chips.some((c) => c.includes('src/{api,routes}/**')), `comma kept in chip: ${chips}`);
      await shot(ctx, '09-rules');
    },
  },
];
