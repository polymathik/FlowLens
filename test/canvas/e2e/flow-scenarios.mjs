/**
 * Map v2 / M6b scenarios, Flow mode, entry-point picker and the flow-app fixture: groups with counts, filter,
 * tests toggle, empty state with symbol search, did-you-mean and candidate pickers, unresolved leaf,
 * text-derived hops, path highlight, `in` direction, T / Shift+T, double-click with a back link, ambiguous
 * candidates. Runs after the focus scenarios. Screenshots: `6x-flow-*.png`.
 */
import { join } from 'node:path';
import { assert, signIn } from './canvas-page.mjs';
import { projectId } from './layers-scenarios.mjs';
import { CANVAS, assertCounts, assertFlowClean, card, count, entryPoints, flowLink, hash, openFlow, openMap, settleFlow, states, tally, trace } from './flow-helpers.mjs';

async function shot(ctx, name) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `${name}.png`) });
}

export const flowScenarios = [
  {
    name: 'flow: picker groups with counts, filter, tests toggle; pick a route; Esc, back and forward',
    async run(ctx) {
      const { page } = ctx;
      const id = await projectId(ctx.projects.flow.root);
      await openMap(ctx, id);
      assert((await count(page, '[data-testid="flow-view"]')) === 0 && !(await page.locator('[data-testid="flow-view"]').count()), 'no flow before');
      await page.click('[data-testid="flow-button"]');
      await page.waitForSelector('[data-testid="flow-picker-body"] [data-testid="flow-entry"]');
      const api = await entryPoints(id);
      const groups = await page.$$eval('[data-testid="flow-group"]', (els) => els.map((e) => [e.getAttribute('data-kind'), e.querySelector('[data-testid="flow-group-count"]').textContent.trim()]));
      for (const [kind, n] of groups) assert(Number(n) === api.counts_by_kind[kind], `group ${kind} shows ${n}, API ${api.counts_by_kind[kind]}`);
      assert(groups.length === Object.keys(api.counts_by_kind).filter((k) => k !== 'test').length, `groups ${JSON.stringify(groups)} vs ${JSON.stringify(api.counts_by_kind)}`);
      assert(groups[0][0] === 'http_route', 'HTTP routes come first');
      assert((await page.locator('[data-testid="flow-group"][data-kind="test"]').count()) === 0, 'tests are hidden by default');
      const confs = await page.$$eval('[data-testid="flow-entry"] .fl-flow-conf', (els) => els.map((e) => e.textContent));
      assert(confs.length > 0 && confs.every((c) => /(sure|likely|guess) \d+%/.test(c)), `confidence shown: ${confs.slice(0, 3)}`);
      await shot(ctx, '60-flow-picker');
      // filter
      await page.fill('[data-testid="flow-picker-filter"]', 'orders');
      const filtered = await page.$$eval('[data-testid="flow-entry"]', (els) => els.map((e) => e.getAttribute('data-label')));
      assert(filtered.includes('GET /api/orders') && !filtered.includes('GET /cats/:id') && filtered.length < api.total, `filter result ${filtered}`);
      await page.fill('[data-testid="flow-picker-filter"]', 'zzzz-nothing');
      await page.waitForSelector('[data-testid="flow-picker-nomatch"]');
      await page.fill('[data-testid="flow-picker-filter"]', '');
      // tests are opt-in
      await page.check('[data-testid="flow-picker-tests"]');
      const withTests = await entryPoints(id, '&include_tests=1');
      assert(withTests.counts_by_kind.test > 0, 'fixture has a test entry');
      await page.waitForSelector('[data-testid="flow-group"][data-kind="test"]');
      await page.uncheck('[data-testid="flow-picker-tests"]');
      // Escape closes the picker even from the filter box
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-testid="flow-picker"]', { state: 'detached' });
      // pick a route
      await page.click('[data-testid="flow-button"]');
      await page.fill('[data-testid="flow-picker-filter"]', 'orders');
      await page.click('[data-testid="flow-entry"][data-label="GET /api/orders"]');
      await page.waitForSelector(`${CANVAS} [data-testid="flow-card"]`);
      await settleFlow(page);
      assert((await page.textContent('[data-testid="crumb-flow"]')) === 'Flow: GET /api/orders', `breadcrumb: ${await page.textContent('[data-testid="crumb-flow"]')}`);
      assert(/\/map\/flow\/[0-9a-f]+\?depth=4$/.test(await hash(page)), `deep link written: ${await hash(page)}`);
      assert((await page.textContent('[data-testid="flow-title"]')) === 'Flow: GET /api/orders', 'bar title');
      const entry = api.entry_points.find((e) => e.label === 'GET /api/orders');
      await assertCounts(page, (await trace(id, entry.label)).body, 'GET /api/orders');
      await assertFlowClean(page, 'GET /api/orders');
      await shot(ctx, '61-flow-orders');
      // Escape leaves; back returns to the flow, forward to the map
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-testid="flow-view"]', { state: 'detached' });
      assert(/\/map\/path\//.test(await hash(page)), `drill-path link after leaving: ${await hash(page)}`);
      await page.goBack();
      await page.waitForSelector(`${CANVAS} [data-testid="flow-card"]`);
      assert(/\/map\/flow\//.test(await hash(page)), 'back returns to the flow link');
      assert((await page.textContent('[data-testid="crumb-flow"]')) === 'Flow: GET /api/orders', 'the flow is back');
      await page.goForward();
      await page.waitForSelector('[data-testid="flow-view"]', { state: 'detached' });
    },
  },
  {
    name: 'flow: a project with no entry points explains why and offers a search for any function',
    async run(ctx) {
      const { page } = ctx;
      const id = await projectId(ctx.projects.layered.root);
      await openMap(ctx, id);
      await page.click('[data-testid="flow-button"]');
      await page.waitForSelector('[data-testid="flow-picker-empty"]');
      assert(/framework/i.test(await page.textContent('[data-testid="flow-picker-empty"]')), 'the empty state explains the detector limits');
      await shot(ctx, '62-flow-no-entry-points');
      await page.fill('[data-testid="flow-symbol-search"]', 'findAll');
      await page.waitForSelector('[data-testid="flow-symbol-hit"]');
      await page.locator('[data-testid="flow-symbol-hit"]').first().click();
      await page.waitForSelector(`${CANVAS} [data-testid="flow-card"]`);
      await settleFlow(page);
      assert(/Flow: .*findAll/.test(await page.textContent('[data-testid="crumb-flow"]')), `traced a plain function: ${await page.textContent('[data-testid="crumb-flow"]')}`);
      await page.click('[data-testid="flow-exit"]');
      await page.waitForSelector('[data-testid="flow-view"]', { state: 'detached' });
    },
  },
  {
    name: 'flow: not found offers did-you-mean chips, an ambiguous name a candidate picker',
    async run(ctx) {
      const { page } = ctx;
      const id = await projectId(ctx.projects.flow.root);
      await signIn(page, ctx.base, flowLink(id, 'GET /api/orderz', '?depth=3'));
      await page.waitForSelector('[data-testid="flow-error"][data-code="not_found"]');
      assert((await page.locator('[data-testid="flow-suggestions"] button', { hasText: 'GET /api/orders' }).count()) === 1, 'the near label is suggested');
      await shot(ctx, '63-flow-not-found');
      await page.locator('[data-testid="flow-suggestions"] button', { hasText: 'GET /api/orders' }).click();
      await page.waitForSelector(`${CANVAS} [data-testid="flow-card"]`);
      assert((await page.textContent('[data-testid="flow-title"]')).includes('GET /api/orders'), 'the suggestion was traced');
      await signIn(page, ctx.base, flowLink(id, 'step', '?depth=3'));
      await page.waitForSelector('[data-testid="flow-error"][data-code="ambiguous"]');
      const n = await page.locator('[data-testid="flow-ambiguous-candidate"]').count();
      assert(n >= 2, `candidates listed: ${n}`);
      await shot(ctx, '64-flow-ambiguous');
      await page.locator('[data-testid="flow-ambiguous-candidate"]').first().click();
      await page.waitForSelector(`${CANVAS} [data-testid="flow-card"]`);
      assert((await page.locator('[data-testid="flow-error"]').count()) === 0, 'the error is gone once a candidate is chosen');
    },
  },
  {
    name: 'flow: unresolved leaf, text-derived hop, candidates chip, click highlights the path, T / Shift+T, double-click and back link',
    async run(ctx) {
      const { page } = ctx;
      const id = await projectId(ctx.projects.flow.root);
      const entries = (await entryPoints(id)).entry_points;
      const post = entries.find((e) => e.label === 'POST /api/users');
      await openFlow(ctx, id, post.entity_id, `?depth=4&span=${post.span.line_start}-${post.span.line_end}`);
      const t = (await trace(id, post.label)).body;
      await assertCounts(page, t, 'POST /api/users');
      const leaf = page.locator('[data-testid="flow-card"][data-role="unresolved"]');
      assert((await leaf.count()) === t.hops.filter((h) => h.resolution === 'unresolved').length && (await leaf.count()) >= 1, 'one dashed leaf per unresolved call');
      assert(/^\?\? /.test(await leaf.first().locator('.fl-flow-name').textContent()), 'the leaf is named "?? callee"');
      assert((await page.locator('[data-testid="flow-hop"][data-kind="unresolved"]').count()) >= 1, 'its hop is drawn unresolved');
      const dotted = await page.locator('[data-testid="flow-hop"][data-dotted="1"][data-provenance="source_scan"]').count();
      assert(dotted === t.hops.filter((h) => h.provenance === 'source_scan').length && dotted >= 1, `text-derived hops are dotted: ${dotted}`);
      assert((await page.locator('[data-testid="flow-notice-text-derived"]').count()) === 1 && (await page.locator('[data-testid="flow-notice-unresolved"]').count()) === 1, 'the notices say so');
      assert((await page.locator('[data-testid="flow-limits"] li').count()) >= 4, 'the "cannot see" disclosure lists the blind spots');
      await page.click('[data-testid="flow-limits"] summary');
      await shot(ctx, '65-flow-post-users');
      await page.click('[data-testid="flow-limits"] summary');
      // click a card: detail panel + path lit, the rest dimmed
      await card(page, 'query()').click();
      await page.waitForSelector('[data-testid="detail-panel"]');
      const cs = tally(await states(page, '[data-testid="flow-card"]'));
      assert(cs.active === 1 && cs.path === 3 && cs.dim === 2, `path from the root to query(): ${JSON.stringify(cs)}`);
      const es = tally(await states(page, '[data-testid="flow-edge"]'));
      assert(es.path === 3 && es.dim >= 1, `edges: ${JSON.stringify(es)}`);
      await shot(ctx, '66-flow-path');
      await page.click(`${CANVAS} .react-flow__pane`);
      assert(!Object.keys(tally(await states(page, '[data-testid="flow-card"]'))).includes('dim'), 'clicking the pane clears the highlight');
      // Who triggers this? from the detail panel
      await card(page, 'query()').click();
      await page.click('[data-testid="detail-triggers"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="flow-dir-in"]')?.getAttribute('aria-pressed') === 'true');
      await page.waitForSelector('[data-testid="flow-view"][data-direction="in"]');
      await settleFlow(page);
      assert(/dir=in/.test(await hash(page)), `direction in the link: ${await hash(page)}`);
      assert((await page.locator('[data-testid="flow-card"][data-role="trigger"]').count()) >= 1, 'entry points that lead here are marked as triggers');
      await shot(ctx, '67-flow-in');
      // T on a selected card re-roots; Esc leaves
      await card(page, 'saveUser()').click();
      await page.keyboard.press('t');
      await page.waitForFunction(() => /saveUser/.test(document.querySelector('[data-testid="flow-title"]')?.textContent ?? ''));
      // double-click opens the structure map with a way back
      await card(page, 'saveUser()').dblclick();
      await page.waitForSelector('[data-testid="flow-view"]', { state: 'detached' });
      await page.waitForSelector('[data-testid="flow-back"]');
      assert(/\/map\/path\//.test(await hash(page)), `the map link: ${await hash(page)}`);
      await page.waitForSelector('[data-testid="detail-panel"]');
      await page.click('[data-testid="flow-back-button"]');
      await page.waitForSelector(`${CANVAS} [data-testid="flow-card"]`);
      assert((await page.textContent('[data-testid="crumb-flow"]')).includes('saveUser'), 'back to the same flow');
    },
  },
  {
    name: 'flow: ambiguous hops are amber with a candidates chip that lists the alternatives',
    async run(ctx) {
      const { page } = ctx;
      const id = await projectId(ctx.projects.flow.root);
      await openFlow(ctx, id, 'src/services/jobs.ts/Job.run', '?depth=4');
      const t = (await trace(id, 'src/services/jobs.ts/Job.run')).body;
      await assertCounts(page, t, 'Job.run');
      assert((await page.locator('[data-testid="flow-hop"][data-kind="ambiguous"]').count()) >= 1, 'ambiguous hops are drawn');
      const chip = page.locator('[data-testid="flow-candidates-chip"]').first();
      assert(/\d+ candidates?/.test(await chip.textContent()), 'the chip counts the candidates');
      await chip.click();
      await page.waitForSelector('[data-testid="flow-candidates"]');
      const names = await page.$$eval('[data-testid="flow-candidate"]', (els) => els.map((e) => e.textContent));
      assert(names.length >= 2 && names.some((n) => /EmailJob\.step/.test(n)), `alternatives: ${names}`);
      await shot(ctx, '68-flow-candidates');
      await page.locator('[data-testid="flow-candidate"]', { hasText: 'EmailJob.step' }).click();
      assert((await tally(await states(page, '[data-testid="flow-card"]')).active) === 1, 'choosing an alternative selects it');
    },
  },
  {
    name: 'flow: step-through honours prefers-reduced-motion (no marching animation, same order)',
    contextOptions: { reducedMotion: 'reduce' },
    async run(ctx) {
      const { page } = ctx;
      const id = await projectId(ctx.projects.flow.root);
      await openFlow(ctx, id, 'src/services/jobs.ts/Job.run', '?depth=4');
      await page.click('[data-testid="flow-step-start"]');
      await page.click('[data-testid="flow-step-next"]');
      await page.waitForSelector(`${CANVAS} [data-testid="flow-hop"][data-state="active"]`);
      const anim = await page.$eval(`${CANVAS} [data-testid="flow-hop"][data-state="active"]`, () => {
        const el = document.querySelector('[data-testid="flow-canvas"] .fl-flow-edge-active');
        return el ? getComputedStyle(el).animationName : 'none';
      });
      assert(anim === 'none', `no animation under reduced motion: ${anim}`);
      await page.click('[data-testid="flow-step-play"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="flow-step-caption"]')?.getAttribute('data-step') === '3', null, { timeout: 8000 });
    },
  },
];
