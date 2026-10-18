/**
 * Multi-project explorer E2E: Home cards, Health → "Show on map", tab state
 * isolation, live updates for the watched project only, deep links into a
 * non-active project, legacy links, missing project, sign-in, keyboard
 * tabs, copy prompt, dark mode.
 *
 * Projects (serve.ts): A = sample-app (cycle view.ts ↔ widgets.ts, rule
 * break api → ui, watched), B = notes-app, missing = registered then deleted.
 */
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { apiJson, assert, nodeIds, settle, signIn } from './canvas-page.mjs';

async function shot(ctx, name) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `${name}.png`) });
}

const attr = (page, sel, name) => page.getAttribute(sel, name);

async function waitMap(page) {
  await page.waitForSelector('[data-testid="map-view"] .react-flow__node', { timeout: 60000 });
  await settle(page);
}

export const explorerScenarios = [
  {
    name: 'explorer: signed-out browser is told how to open FlowLens',
    async run({ page, base }) {
      await page.goto(`${base}/#/home`);
      await page.waitForSelector('[data-testid="sign-in-needed"]');
      assert((await page.textContent('[data-testid="sign-in-needed"]')).includes('flowlens canvas'), 'mentions the command');
    },
  },
  {
    name: 'explorer: Home shows a card per project, worst first, missing last',
    async run(ctx) {
      const { page, base, projects } = ctx;
      await signIn(page, base, '#/home');
      await page.waitForSelector(`[data-testid="card-${projects.a.id}"][data-grade]:not([data-grade=""])`);
      await page.waitForSelector(`[data-testid="card-${projects.b.id}"][data-grade]:not([data-grade=""])`);
      const order = await page.$$eval('[data-testid="home-cards"] .fl-card', (els) => els.map((e) => e.getAttribute('data-testid')));
      assert(order.length === 3, `three cards: ${order}`);
      assert(order[2] === `card-${projects.missing.id}`, `missing project last: ${order}`);
      const scoreA = Number(await attr(page, `[data-testid="card-${projects.a.id}"]`, 'data-score'));
      const scoreB = Number(await attr(page, `[data-testid="card-${projects.b.id}"]`, 'data-score'));
      assert(scoreA <= scoreB, `A (cycle, rule break) scores no better than B: ${scoreA} vs ${scoreB}`);
      assert(order[0] === `card-${scoreA <= scoreB ? projects.a.id : projects.b.id}`, 'worst first');
      const topA = await page.textContent(`[data-testid="card-${projects.a.id}"] [data-testid="card-top"]`);
      assert(topA.length > 10, `A shows its top finding: ${topA}`);
      assert((await page.textContent(`[data-testid="card-${projects.missing.id}"]`)).includes('Missing'), 'missing badge');
      await shot(ctx, '10-home');
    },
  },
  {
    name: 'explorer: Health → Show on map turns on the overlay and highlights the files',
    async run(ctx) {
      const { page, base, projects } = ctx;
      await signIn(page, base, '#/home');
      await page.click(`[data-testid="card-${projects.a.id}"]`);
      await page.waitForSelector('[data-testid="health-view"] [data-testid="health-grade"]');
      assert((await page.evaluate(() => window.location.hash)) === `#/p/${projects.a.id}/health`, 'card opens Health');
      assert((await attr(page, '[data-testid="explorer"]', 'data-active-tab')) === projects.a.id, 'A tab active');
      await page.waitForSelector('[data-testid="score-breakdown"]');
      await shot(ctx, '11-health');
      const cycle = page.locator('[data-kind="cycle"]').first();
      await cycle.locator('[data-testid="show-on-map"]').click();
      await waitMap(page);
      assert((await page.inputValue('[data-testid="overlay-select"]')) === 'cycles', 'cycles overlay on');
      await page.waitForSelector('.react-flow__node[data-id="file:src/ui/view.ts"] .flowlens-node[data-highlighted="true"]');
      await page.waitForSelector('.react-flow__node[data-id="file:src/ui/widgets.ts"] .flowlens-node[data-highlighted="true"]');
      const selected = await page.$$eval('.flowlens-node[data-selected="true"]', (els) => els.length);
      assert(selected === 1, `focus target selected (${selected})`);
      await shot(ctx, '12-show-on-map');
    },
  },
  {
    name: 'explorer: tabs keep separate state; only the watched project updates',
    async run(ctx) {
      const { page, base, projects } = ctx;
      await signIn(page, base, `#/p/${projects.a.id}/map?overlay=cycles`);
      await waitMap(page);
      await page.dblclick('.react-flow__node[data-id="folder:src"] [data-testid="zone-chip"]');
      await settle(page);
      assert((await nodeIds(page)).includes('folder:src/ui'), 'A drilled into src');

      await signInTab(page, projects.b.id);
      await waitMap(page);
      const idsB = await nodeIds(page);
      assert(!idsB.some((id) => id.startsWith('folder:src/ui')), `B shows its own graph: ${idsB}`);
      assert((await page.inputValue('[data-testid="overlay-select"]')) === '', 'B has no overlay');
      const crumbB = await page.textContent('[data-testid="breadcrumb"]');
      assert(!crumbB.includes('src /'), `B breadcrumb is at the root: ${crumbB}`);

      await page.click(`[data-testid="tab-${projects.a.id}"]`);
      await waitMap(page);
      assert((await page.inputValue('[data-testid="overlay-select"]')) === 'cycles', 'A kept its overlay');
      assert((await nodeIds(page)).includes('folder:src/ui'), 'A kept its drill path');

      const before = Number(await attr(page, '[data-testid="map-view"]', 'data-node-count'));
      const revB = await attr(page, `[data-testid="tab-${projects.b.id}"]`, 'data-revision');
      await writeFile(join(projects.a.root, 'src/core/extra.ts'), 'export function addedLater(x: number): number {\n  return x * 2;\n}\n');
      await page.waitForFunction(
        (n) => Number(document.querySelector('[data-testid="map-view"]')?.getAttribute('data-node-count')) > n,
        before,
        { timeout: 20000 },
      );
      assert(Number(await attr(page, `[data-testid="tab-${projects.a.id}"]`, 'data-revision')) > 0, 'A revision bumped');
      await page.waitForTimeout(800);
      assert((await attr(page, `[data-testid="tab-${projects.b.id}"]`, 'data-revision')) === revB, 'B did not change');
      await appendFile(join(projects.a.root, 'src/core/extra.ts'), '\n');
      await shot(ctx, '13-tabs-live');
    },
  },
  {
    name: 'explorer: deep link into another project, legacy link maps to the active tab',
    async run(ctx) {
      const { page, base, projects } = ctx;
      await signIn(page, base, '#/home');
      await page.waitForSelector('[data-testid="home-cards"]');
      const entitiesB = await apiJson(ctx.api.replace(projects.a.id, projects.b.id), '/entities');
      const qn = entitiesB.find((e) => e.name === 'formatTitle').qualified_name;
      await page.evaluate((h) => (window.location.hash = h), `#/p/${projects.b.id}/entity/${encodeURIComponent(qn)}`);
      await page.waitForSelector('.flowlens-node[data-selected="true"]', { timeout: 60000 });
      assert((await attr(page, '[data-testid="explorer"]', 'data-active-tab')) === projects.b.id, 'B tab opened');
      assert((await page.textContent('[data-testid="breadcrumb"]')).includes('format.ts'), 'drilled into format.ts');

      await page.evaluate(() => (window.location.hash = `#/file/${encodeURIComponent('src/notes/note.ts')}`));
      await page.waitForSelector('.react-flow__node[data-id="file:src/notes/note.ts"] .flowlens-node[data-selected="true"]');
      const hash = await page.evaluate(() => window.location.hash);
      assert(hash.startsWith(`#/p/${projects.b.id}/map/`), `legacy link rewritten onto B: ${hash}`);
      assert(hash.includes('/map/path/') && hash.includes('notes'), `normalised to the real path of the folder: ${hash}`);
    },
  },
  {
    name: 'explorer: keyboard moves between tabs; "+" picker opens a project',
    async run(ctx) {
      const { page, base, projects } = ctx;
      await signIn(page, base, '#/home');
      await page.waitForSelector('[data-testid="home-cards"]');
      await page.click('[data-testid="tab-add"]');
      await page.waitForSelector('[data-testid="project-picker"]');
      await shot(ctx, '14-picker');
      await page.click(`[data-testid="pick-${projects.b.id}"]`);
      await page.waitForSelector(`[data-testid="project-${projects.b.id}"]`);
      await page.focus('[data-testid="tab-home"]');
      await page.keyboard.press('ArrowRight');
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      assert(focused?.startsWith('tab-') && focused !== 'tab-home', `focus moved to a project tab (${focused})`);
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-testid="home-cards"]');
    },
  },
  {
    name: 'explorer: Copy fix prompt puts the prompt on the clipboard',
    contextOptions: { permissions: ['clipboard-read', 'clipboard-write'] },
    async run(ctx) {
      const { page, base, projects } = ctx;
      await signIn(page, base, `#/p/${projects.a.id}/health`);
      await page.waitForSelector('[data-testid="copy-prompt"]');
      await page.locator('[data-testid="copy-prompt"]').first().click();
      await page.waitForSelector('.fl-copied');
      const text = await page.evaluate(() => navigator.clipboard.readText());
      assert(/behaviour exactly the same/i.test(text), `prompt copied: ${text.slice(0, 80)}`);
    },
  },
  {
    name: 'explorer: dark mode Home and Health',
    contextOptions: { colorScheme: 'dark' },
    async run(ctx) {
      const { page, base, projects } = ctx;
      await signIn(page, base, '#/home');
      await page.waitForSelector(`[data-testid="card-${projects.a.id}"][data-grade]:not([data-grade=""])`);
      const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.fl-app')).backgroundColor);
      assert(bg === 'rgb(15, 20, 27)', `dark background (${bg})`);
      await shot(ctx, '15-home-dark');
      await page.click(`[data-testid="card-${projects.a.id}"]`);
      await page.waitForSelector('[data-testid="health-grade"]');
      await shot(ctx, '16-health-dark');
      await page.click('[data-testid="view-map"]');
      await waitMap(page);
      await shot(ctx, '17-map-dark');
      // Phase 12: overlay fills and minimap use the dark theme tokens.
      const minimap = await page.evaluate(() => [...document.querySelectorAll('.react-flow__minimap-node')].map((n) => getComputedStyle(n).fill));
      const lightMinimap = ['rgb(129, 140, 248)', 'rgb(94, 234, 212)', 'rgb(147, 197, 253)', 'rgb(203, 213, 225)'];
      assert(minimap.length > 0 && minimap.every((f) => !lightMinimap.includes(f)), `dark minimap fills (${minimap.slice(0, 3)})`);
      await page.selectOption('[data-testid="overlay-select"]', 'cycles');
      await page.waitForSelector('.flowlens-node[data-overlay="cycles:muted"]');
      const muted = await page.evaluate(() => getComputedStyle(document.querySelector('.flowlens-node[data-overlay="cycles:muted"]')).backgroundColor);
      const [r, g, b] = muted.match(/\d+/g).map(Number);
      assert(r + g + b < 200, `muted overlay node is dark (${muted})`);
      await shot(ctx, '17b-map-dark-cycles');
    },
  },
  {
    name: 'explorer: a missing project explains itself and can be removed',
    async run(ctx) {
      const { page, base, projects } = ctx;
      await signIn(page, base, `#/p/${projects.missing.id}`);
      await page.waitForSelector('[data-testid="missing-project"]');
      assert((await page.textContent('[data-testid="missing-project"]')).includes(projects.missing.root), 'shows the path');
      await shot(ctx, '18-missing');
      await page.click('[data-testid="remove-project"]');
      await page.waitForSelector('[data-testid="home-cards"]');
      await page.waitForFunction((id) => !document.querySelector(`[data-testid="card-${id}"]`), projects.missing.id);
      assert(!(await page.$(`[data-testid="tab-${projects.missing.id}"]`)), 'tab closed');
    },
  },
];

/** Open a project tab's map via the URL (same session). */
async function signInTab(page, projectId) {
  await page.evaluate((h) => (window.location.hash = h), `#/p/${projectId}/map`);
}
