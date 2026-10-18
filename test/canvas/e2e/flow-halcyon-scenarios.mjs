/**
 * Map v2 / M6b scenarios, Flow mode on the Halcyon copy (skipped without a snapshot): `GET /api/sessions/:sessionId/command`
 * counted against the REST trace, step-through order, path highlight, deep link with back / forward, `bin: halcyon`
 * capped at 150 nodes inside the viewport (light and dark), and reduced motion. Screenshots: `7x-flow-*.png`.
 */
import { join } from 'node:path';
import { assert } from './canvas-page.mjs';
import { projectId } from './layers-scenarios.mjs';
import { CANVAS, assertCounts, assertFlowClean, card, entryPoints, expectedCounts, hash, openFlow, openMap, settleFlow, states, tally, trace } from './flow-helpers.mjs';

async function shot(ctx, name) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `${name}.png`) });
}

export const flowHalcyonScenarios = [
  {
    name: 'flow: Halcyon GET /api/sessions/:sessionId/command matches the REST trace; step-through, path, deep link, back / forward',
    async run(ctx) {
      const { page } = ctx;
      if (!ctx.projects.halcyon) return console.log('    (skipped: no Halcyon snapshot)');
      const id = await projectId(ctx.projects.halcyon.root);
      const label = 'GET /api/sessions/:sessionId/command';
      const entry = (await entryPoints(id)).entry_points.find((e) => e.label === label);
      assert(entry && entry.span, 'the route is detected as an inline handler');
      await openMap(ctx, id);
      await page.click('[data-testid="flow-button"]');
      await page.fill('[data-testid="flow-picker-filter"]', 'sessions/:sessionId/command');
      await page.click(`[data-testid="flow-entry"][data-label="${label}"]`);
      await page.waitForSelector(`${CANVAS} [data-testid="flow-card"]`);
      await settleFlow(page);
      const t = (await trace(id, label)).body;
      await assertCounts(page, t, label);
      assert((await page.textContent('[data-testid="crumb-flow"]')) === `Flow: ${label}`, 'breadcrumb names the route');
      const link = await hash(page);
      assert(new RegExp(`/map/flow/${entry.entity_id}\\?depth=4&span=${entry.span.line_start}-${entry.span.line_end}$`).test(link), `deep link: ${link}`);
      assert((await page.locator('[data-testid="flow-lane"]').count()) === 2, 'two lanes (packages)');
      const stats = await page.getAttribute('[data-testid="flow-stats"]', 'data-hops');
      assert(Number(stats) === t.hops.length, 'the bar counts the hops');
      await assertFlowClean(page, label);
      await shot(ctx, '70-flow-halcyon-command');
      // hovering a hop widens its label to the full reference line
      const hop = page.locator(`${CANVAS} [data-testid="flow-hop"][data-step="1"]`);
      await hop.hover();
      assert(await hop.locator('.fl-flow-full').isVisible(), 'hover shows the full path');
      assert((await hop.locator('.fl-flow-full').textContent()) === `${t.hops[0].ref.file}:${t.hops[0].ref.line}`, `full reference: ${await hop.locator('.fl-flow-full').textContent()}`);
      await page.mouse.move(5, 5);
      // step through in call order
      await page.click('[data-testid="flow-step-start"]');
      assert((await page.getAttribute('[data-testid="flow-step-caption"]', 'data-step')) === '0', 'step 0 lights the root');
      for (let k = 1; k <= t.hops.length; k++) {
        await page.click('[data-testid="flow-step-next"]');
        const caption = await page.textContent('[data-testid="flow-step-caption"]');
        assert(caption.startsWith(`${k}/${t.hops.length}`), `caption ${k}: ${caption}`);
        const active = page.locator(`${CANVAS} [data-testid="flow-hop"][data-state="active"]`);
        assert((await active.getAttribute('data-step')) === String(k), `hop ${k} is the active one`);
        const h = t.hops[k - 1];
        assert((await active.textContent()).includes(`${h.ref.file.split('/').pop()}:${h.ref.line}`), `hop ${k} shows ${h.ref.file}:${h.ref.line}`);
        const lit = (await tally(await states(page, '[data-testid="flow-card"]'))).dim ?? 0;
        const reached = new Set([t.root.entity_id, ...t.hops.slice(0, k).flatMap((x) => [x.from, x.to])]);
        assert(t.nodes.length - reached.size === lit || t.nodes.length - [...reached].filter((r) => t.nodes.some((n) => n.id === r)).length === lit, `step ${k}: ${lit} cards still dim`);
        if (k === 3) await shot(ctx, '71-flow-halcyon-step3');
      }
      assert((await page.locator('[data-testid="flow-step-next"]').isDisabled()), 'Next is disabled after the last hop');
      await page.click('[data-testid="flow-step-stop"]');
      assert(!(await states(page, '[data-testid="flow-card"]')).includes('dim'), 'leaving step-through restores the picture');
      // a click lights the path from the root
      await card(page, 'toSessionId()').click();
      const cs = tally(await states(page, '[data-testid="flow-card"]'));
      assert(cs.active === 1 && cs.path === 2 && cs.dim === t.nodes.length - 3, `path root > parseSessionId > toSessionId: ${JSON.stringify(cs)}`);
      await shot(ctx, '72-flow-halcyon-path');
      await page.click(`${CANVAS} .react-flow__pane`);
      // copy the trace as text
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(ctx.base).origin }).catch(() => {});
      await page.click('[data-testid="flow-copy-trace"]');
      const text = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      if (text) assert(text.includes(label) && text.includes('parseSessionId'), `copied text: ${text.slice(0, 120)}`);
      // the permalink opens the same picture in a fresh page
      const fresh = await ctx.context.newPage();
      await fresh.goto(`${ctx.base}/${link}`);
      await fresh.waitForSelector(`${CANVAS} [data-testid="flow-card"]`, { timeout: 60000 });
      await settleFlow(fresh);
      await assertCounts(fresh, t, 'permalink');
      await fresh.close();
      // a setting is a replace, not a history entry; leaving and back / forward
      const entries = await page.evaluate(() => history.length);
      await page.locator('[data-testid="flow-depth"]').fill('2');
      await page.waitForFunction(() => /depth=2/.test(location.hash));
      assert((await page.evaluate(() => history.length)) === entries, 'depth is in the link without a new history entry');
      await settleFlow(page);
      await assertCounts(page, (await trace(id, label, { depth: '2' })).body, 'depth 2');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-testid="flow-view"]', { state: 'detached' });
      await page.goBack();
      await page.waitForSelector(`${CANVAS} [data-testid="flow-card"]`);
      assert(/depth=2/.test(await hash(page)), 'back restores the flow with its depth');
      await page.goForward();
      await page.waitForSelector('[data-testid="flow-view"]', { state: 'detached' });
    },
  },
  {
    name: 'flow: Halcyon bin: halcyon is capped, says so, and stays inside the viewport without overlaps (light and dark)',
    contextOptions: { colorScheme: 'dark' },
    async run(ctx) {
      const { page } = ctx;
      if (!ctx.projects.halcyon) return console.log('    (skipped: no Halcyon snapshot)');
      const id = await projectId(ctx.projects.halcyon.root);
      const entry = (await entryPoints(id)).entry_points.find((e) => e.label === 'bin: halcyon');
      await openFlow(ctx, id, entry.entity_id, '?depth=4');
      const t = (await trace(id, 'bin: halcyon')).body;
      await assertCounts(page, t, 'bin: halcyon');
      assert(t.nodes.length > 100, `a big flow: ${t.nodes.length} nodes`);
      assert(await assertFlowClean(page, 'bin: halcyon depth 4') === expectedCounts(t).cards, 'every card is visible and clean');
      assert((await page.locator(`${CANVAS} [data-testid="flow-hop"]`).count()) === 0, 'a dense trace draws its call-site labels only on hover, the path and the step');
      await shot(ctx, '73-flow-halcyon-bin-dark');
      await openFlow(ctx, id, entry.entity_id, '?depth=5');
      const t5 = (await trace(id, 'bin: halcyon', { depth: '5' })).body;
      assert(t5.truncated && t5.stats.dropped > 0 && t5.nodes.length === 150, `depth 5 hits the cap: ${t5.nodes.length}, dropped ${t5.stats.dropped}`);
      await assertCounts(page, t5, 'bin: halcyon depth 5');
      const notice = await page.textContent('[data-testid="flow-notice-truncated"]');
      assert(notice.startsWith(`+${t5.stats.dropped} more nodes hidden`), `truncation notice: ${notice}`);
      await assertFlowClean(page, 'bin: halcyon depth 5');
      await page.emulateMedia({ colorScheme: 'light' });
      await settleFlow(page);
      await shot(ctx, '74-flow-halcyon-bin-cap-light');
    },
  },
];
