/**
 * Map v2 / M5b scenarios: the growth timeline. The fixture is a 14-commit monorepo (two authors, a rename, a
 * delete-and-re-add, ghost-only deletions inside a package, inside a vanished folder and in tools/), and the truth
 * every assertion is compared with is git itself (`git ls-tree`, `git diff --name-status`).
 *
 *   - scrubbing first / middle / HEAD shows exactly the files git has at those commits, and no link is drawn
 *   - stepping and playing never move or resize a card (layout is computed once)
 *   - deleted files ghost out (dashed), a deleted-only file in a gone folder lands in "Deleted", a re-added file
 *     enters again, a renamed file is one card, zone chips show +N
 *   - keyboard, play / pause / speed, stop at HEAD, compare (A/B) vs `git diff`
 *   - states: loading does not block the Map; not a git repository; history too short
 *   - prefers-reduced-motion: no entering / pulse classes
 *   - link history: a real build adds edges (none before the first sample), cancel works (against a faked slow job)
 * The real link-history build runs last: it stores a topology file in the fixture.
 */
import { assert, bar, cardsByState, goTo, nodeClass, openTimeline, rects, register, shot, truthFor } from './timeline-helpers.mjs';

const LAST = 13;
const hist = (ctx) => truthFor(ctx.projects.hist.root);
const rootLevel = (p) => !p.includes('/');
const countRects = (r) => Object.keys(r).length;
const edgeCount = (page) => page.$$eval('.react-flow__edge', (e) => e.length);

async function eachCommitMatchesGit(ctx) {
  const t = await hist(ctx);
  assert(t.history.commits.length === LAST + 1, `fixture has ${LAST + 1} mainline commits, got ${t.history.commits.length}`);
  await openTimeline(ctx, t.id);
  for (const [i, name] of [[0, 'tl-first'], [6, 'tl-middle'], [LAST, 'tl-head']]) {
    await goTo(ctx.page, i, LAST);
    const b = await bar(ctx.page);
    const truth = t.files(i);
    assert(b.index === i, `playhead at ${i}, bar says ${b.index}`);
    assert(b.files === truth.length, `commit ${i}: bar counts ${b.files} files, git ls-tree ${truth.length}`);
    const { live } = await cardsByState(ctx.page);
    const expected = truth.filter((p) => !rootLevel(p)).length;
    assert(live.length === expected, `commit ${i}: ${live.length} live file cards, git has ${expected} (${truth.length} with root files)`);
    const want = t.history.commits[i].sha.slice(0, 7);
    const sha = await ctx.page.textContent('[data-testid="tl-sha"]');
    assert(sha.trim() === want, `commit line shows ${sha}, wanted ${want}`);
    assert((await edgeCount(ctx.page)) === 0, `commit ${i}: links are hidden without link history`);
    await shot(ctx, name);
  }
}

async function nothingMoves(ctx) {
  const t = await hist(ctx);
  await openTimeline(ctx, t.id);
  const { page } = ctx;
  const snap = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.react-flow__node')].map((n) => [n.getAttribute('data-id'), `${n.style.transform}|${n.style.width}x${n.style.height}`])));
  const before = await snap();
  await goTo(page, 0, LAST);
  await page.click('[data-testid="tl-next"]');
  await page.click('[data-testid="tl-next"]');
  await page.click('[data-testid="tl-first"]');
  await page.click('[data-testid="tl-speed-4"]');
  await page.click('[data-testid="tl-play"]');
  let moved = 0;
  let frames = 0;
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const now = await snap();
    frames++;
    for (const k of Object.keys(before)) if (before[k] !== now[k]) moved++;
    const b = await bar(page);
    seen.add(b.index);
    if (b.playing === 'false' && b.index === LAST) break;
    await page.waitForTimeout(120);
  }
  const end = await bar(page);
  assert(end.index === LAST && end.playing === 'false', `playback stops at the newest commit (index ${end.index}, playing ${end.playing})`);
  assert(seen.size >= 6, `playback passed through several commits, saw ${[...seen].join(',')}`);
  assert(moved === 0, `${moved} card position/size changes over ${frames} samples while playing`);
  assert(countRects(await rects(page)) === Object.keys(before).length, 'no card was mounted or unmounted while playing');
}

async function ghostsAndRenames(ctx) {
  const t = await hist(ctx);
  await openTimeline(ctx, t.id);
  const { page } = ctx;
  const cls = (id) => nodeClass(page, id);
  const legacy = 'file:packages/server/src/legacy/old-auth.ts';
  await goTo(page, 6, LAST);
  assert(/fl-tl-ghost/.test(await cls('file:scratch/tmp.ts')), 'scratch/tmp.ts (deleted at 6, folder gone) is a ghost at 6');
  assert(/fl-zone-frame/.test(await cls('folder:__deleted__')) && !/fl-tl-absent/.test(await cls('folder:__deleted__')), 'the Deleted area is shown while it holds a ghost');
  await shot(ctx, 'tl-ghosts-deleted-area');
  assert(!/fl-tl-ghost|fl-tl-absent/.test(await cls(legacy)), 'legacy shim is alive at 6');
  await goTo(page, 7, LAST);
  assert(/fl-tl-ghost/.test(await cls(legacy)), 'legacy shim ghosts out the commit it is deleted');
  const ghosts = (await cardsByState(page)).ghost.length;
  assert(ghosts >= 2, `at least both legacy files are ghosts at 7, got ${ghosts}`);
  await shot(ctx, 'tl-ghosts');
  await goTo(page, 11, LAST);
  assert(/fl-tl-absent/.test(await cls(legacy)), 'the ghost is gone after the window');
  assert(/fl-tl-absent/.test(await cls('file:packages/server/src/legacy/old-token.ts')), 'old-token is gone as well');

  await goTo(page, 8, LAST);
  assert(!/fl-tl-ghost|fl-tl-absent/.test(await cls('file:packages/web/src/ui/card.ts')), 'card.ts alive at 8');
  await page.click('[data-testid="tl-next"]');
  assert(/fl-tl-ghost/.test(await cls('file:packages/web/src/ui/card.ts')), 'card.ts ghosts at 9');
  await page.click('[data-testid="tl-next"]');
  const back = await cls('file:packages/web/src/ui/card.ts');
  assert(!/fl-tl-ghost|fl-tl-absent/.test(back) && /fl-tl-in-/.test(back), `card.ts enters again at 10 (${back})`);

  await goTo(page, 1, LAST);
  assert(/fl-tl-absent/.test(await cls('file:packages/server/src/routes/people.ts')), 'people.ts is not there at 1');
  await goTo(page, 2, LAST);
  assert(!/fl-tl-absent/.test(await cls('file:packages/server/src/routes/people.ts')), 'the renamed file is one card, alive from its birth as users.ts (2)');
  assert((await page.$('.react-flow__node[data-id="file:packages/server/src/routes/users.ts"]')) === null, 'no card for the old name');

  await goTo(page, LAST, LAST);
  assert((await cardsByState(page)).ghost.length === 0, 'no ghost at the newest commit: HEAD is today\'s map');
}

async function zoneChips(ctx) {
  const t = await hist(ctx);
  await openTimeline(ctx, t.id);
  const { page } = ctx;
  await goTo(page, 7, LAST);
  await page.click('[data-testid="tl-next"]'); // 8: modal.ts joins packages/web
  await page.waitForTimeout(300);
  const text = await page.$eval('.react-flow__node[data-id="package:packages/web"] [data-testid="zone-chip"]', (e) => e.textContent);
  assert(/\+1/.test(text), `the web zone chip shows +1 after the commit that adds modal.ts (${text})`);
  const empty = await nodeClass(page, 'package:packages/web');
  assert(!/fl-tl-absent/.test(empty), 'web zone is visible');
  await goTo(page, 0, LAST);
  assert(/fl-tl-absent/.test(await nodeClass(page, 'package:packages/web')), 'a zone with no files yet is hidden');
}

async function keyboardAndPlayback(ctx) {
  const t = await hist(ctx);
  await openTimeline(ctx, t.id);
  const { page } = ctx;
  const idx = async () => (await bar(page)).index;
  await page.locator('[data-testid="tl-slider"]').focus();
  await page.keyboard.press('Home');
  assert((await idx()) === 0, 'Home jumps to the first commit');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert((await idx()) === 2, 'Right steps forward');
  await page.keyboard.press('ArrowLeft');
  assert((await idx()) === 1, 'Left steps back');
  await page.keyboard.press('End');
  assert((await idx()) === LAST, 'End jumps to the newest commit');
  const slider = await page.$eval('[data-testid="tl-slider"]', (e) => ({ role: e.getAttribute('role'), now: e.getAttribute('aria-valuenow'), max: e.getAttribute('aria-valuemax'), text: e.getAttribute('aria-valuetext') }));
  assert(slider.role === 'slider' && slider.max === String(LAST + 1) && slider.now === String(LAST + 1) && /Commit 14 of 14/.test(slider.text), `slider is accessible (${JSON.stringify(slider)})`);
  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('[data-testid="tl-bar"]').dataset.playing === 'true');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('[data-testid="tl-bar"]').dataset.playing === 'false');
  const paused = await idx();
  await page.waitForTimeout(600);
  assert((await idx()) === paused, 'Space pauses: the playhead stays put');
  for (const sp of [1, 4, 16]) {
    await page.click(`[data-testid="tl-speed-${sp}"]`);
    assert((await page.getAttribute(`[data-testid="tl-speed-${sp}"]`, 'aria-pressed')) === 'true', `speed ${sp}× is pressed`);
  }
  await goTo(page, 0, LAST);
  await page.click('[data-testid="tl-play"]');
  await page.waitForFunction((n) => document.querySelector('[data-testid="tl-bar"]').dataset.index === String(n), LAST, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="tl-bar"]').dataset.playing === 'false');
  await page.click('[data-testid="tl-play"]'); // at HEAD, Play starts over
  await page.waitForFunction(() => document.querySelector('[data-testid="tl-bar"]').dataset.index !== String(13), null, { timeout: 5000 });
  await page.click('[data-testid="tl-play"]');
}

async function chartToggle(ctx) {
  const t = await hist(ctx);
  await openTimeline(ctx, t.id);
  const { page } = ctx;
  await goTo(page, 9, LAST);
  await page.waitForTimeout(500);
  assert((await page.$$('[data-testid="tl-legend"] > span')).length >= 3, 'the chart is open by default and its legend lists the zones');
  const open = (await page.$eval('[data-testid="tl-stage"]', (e) => e.getBoundingClientRect().height));
  await shot(ctx, 'tl-chart-files');
  await page.click('[data-testid="tl-metric-loc"]');
  await page.waitForTimeout(300);
  assert((await page.getAttribute('[data-testid="tl-metric-loc"]', 'aria-pressed')) === 'true', 'lines of code metric is on');
  await shot(ctx, 'tl-chart-loc');
  await page.click('[data-testid="tl-chart-toggle"]');
  await page.waitForTimeout(400);
  const closed = (await page.$eval('[data-testid="tl-stage"]', (e) => e.getBoundingClientRect().height));
  assert(closed < open, `closing the chart makes the bar smaller (${closed} < ${open})`);
  assert((await bar(page)).index === 9, 'the playhead did not move');
}

async function compareTwo(ctx) {
  const t = await hist(ctx);
  await openTimeline(ctx, t.id);
  const { page } = ctx;
  await goTo(page, 6, LAST);
  await page.click('[data-testid="tl-compare"]');
  await goTo(page, LAST, LAST);
  await page.waitForSelector('[data-testid="tl-compare-card"]');
  const want = t.diff(6, LAST);
  const text = await page.textContent('[data-testid="tl-compare-files"]');
  const [added, removed, changed] = text.match(/\d+/g).map(Number);
  assert(added === want.added.length && removed === want.removed.length && changed === want.changed.length,
    `compare 6 → ${LAST} says +${added} −${removed} ~${changed}; git diff has +${want.added.length} −${want.removed.length} ~${want.changed.length} (${JSON.stringify(want)})`);
  const marked = await page.$$eval('.react-flow__node[class*="fl-tl-cmp-"]', (n) => n.length);
  assert(marked >= want.added.length + want.removed.length, `changed cards are highlighted (${marked})`);
  assert((await page.$('[data-testid="tl-marker-a"]')) !== null, 'marker A is drawn on the scrubber');
  await shot(ctx, 'tl-compare');
  await page.click('[data-testid="tl-compare-clear"]');
  assert((await page.$('[data-testid="tl-compare-card"]')) === null, 'clear removes the card');
}

async function loadingDoesNotBlock(ctx) {
  const t = await hist(ctx);
  const { page } = ctx;
  await page.route(/\/canvas\/history(\?|$)/, async (route) => { await new Promise((r) => setTimeout(r, 3500)); await route.continue(); });
  await openTimeline(ctx, t.id, { wait: false });
  await page.waitForSelector('[data-testid="tl-loading"]');
  const before = await page.$$eval('.react-flow__node', (n) => n.length);
  assert(before > 0, 'the Map is on screen while the history builds');
  await page.locator('.react-flow__node[data-id="package:packages/web"] [data-testid="zone-chip"]').dblclick();
  await page.waitForTimeout(400);
  assert((await page.$('[data-testid="tl-loading"]')) !== null, 'still loading, and the Map took the double click');
  await page.waitForSelector('[data-testid="tl-bar"]', { timeout: 20000 });
}

async function emptyStates(ctx) {
  const { page } = ctx;
  await openTimeline(ctx, ctx.projects.b.id, { wait: false });
  await page.waitForSelector('[data-testid="tl-empty-message"]', { timeout: 20000 });
  const notGit = await page.textContent('[data-testid="tl-empty-message"]');
  assert(/not a git repository/i.test(notGit), `non-git project explains itself: ${notGit}`);
  assert((await page.$$('.react-flow__node')).length > 0, 'the Map is untouched');
  await shot(ctx, 'tl-empty-not-git');
  await page.click('[data-testid="tl-close"]');
  const tinyId = await register(ctx.projects.tiny.root);
  await openTimeline(ctx, tinyId, { wait: false });
  await page.waitForSelector('[data-testid="tl-empty-message"]', { timeout: 20000 });
  const short = await page.textContent('[data-testid="tl-empty-message"]');
  assert(/history too short/i.test(short), `single-commit project: ${short}`);
  await shot(ctx, 'tl-empty-too-short');
}

async function reducedMotion(ctx) {
  const t = await hist(ctx);
  await openTimeline(ctx, t.id);
  const { page } = ctx;
  await goTo(page, 7, LAST);
  for (let i = 0; i < 4; i++) {
    await page.click('[data-testid="tl-next"]');
    const animated = await page.$$eval('.react-flow__node', (n) => n.filter((e) => /fl-tl-(in|pulse)-/.test(e.className)).length);
    assert(animated === 0, `step ${i}: no entering / pulse classes with reduced motion (${animated})`);
  }
  await page.click('[data-testid="tl-first"]');
  await page.click('[data-testid="tl-speed-16"]');
  await page.click('[data-testid="tl-play"]');
  await page.waitForFunction((n) => document.querySelector('[data-testid="tl-bar"]').dataset.index === String(n), LAST, { timeout: 20000 });
}

async function darkMode(ctx) {
  const t = await hist(ctx);
  await openTimeline(ctx, t.id);
  await goTo(ctx.page, 9, LAST);
  await ctx.page.waitForTimeout(800);
  await shot(ctx, 'tl-dark');
}

/** A faked slow job (the fixture builds in about a second): progress shows, cancel reaches the server. */
async function linkHistoryCancel(ctx) {
  const t = await hist(ctx);
  const { page } = ctx;
  let cancelled = false;
  const status = (state) => ({ ok: true, state, job_id: 'j1', progress: state === 'running' ? { done: 3, total: 14, reused: 0, skipped: 0, current: 'abcdef1234' } : null, started_at: null, finished_at: null, error: null });
  await page.route(/\/history\/topology\/build/, (route) => {
    const m = route.request().method();
    if (m === 'POST') return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true, job_id: 'j1', status: status('running') }) });
    cancelled = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status('cancelled')) });
  });
  await page.route(/\/history\/topology\/status/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status(cancelled ? 'cancelled' : 'running')) }));
  await openTimeline(ctx, t.id);
  await page.click('[data-testid="tl-links"]');
  const panel = await page.textContent('[data-testid="tl-topology-panel"]');
  assert(/10 s each|roughly 10/.test(panel) && /Without it/.test(panel), `the panel explains the cost: ${panel.slice(0, 160)}`);
  await page.click('[data-testid="tl-topology-start"]');
  await page.waitForSelector('[data-testid="tl-topology-progress"]');
  assert(/3 of 14/.test(await page.textContent('[data-testid="tl-topology-panel"]')), 'progress is shown');
  await goTo(page, 4, LAST);
  assert((await bar(page)).index === 4, 'the timeline keeps working while the job runs');
  await page.click('[data-testid="tl-topology-cancel"]');
  await page.waitForFunction(() => /Cancelled/.test(document.querySelector('[data-testid="tl-topology-panel"]')?.textContent ?? ''));
  assert(cancelled, 'the cancel request reached the server');
}

/** A real build (runs last: it stores a topology): links appear after the first sample and grow with the code. */
async function linkHistoryReal(ctx) {
  const t = await hist(ctx);
  const { page } = ctx;
  await openTimeline(ctx, t.id);
  await page.click('[data-testid="tl-links"]');
  await page.click('[data-testid="tl-topology-start"]');
  await page.waitForFunction(() => /Rebuild|failed|Could not/i.test(document.querySelector('[data-testid="tl-topology-panel"]')?.textContent ?? ''), null, { timeout: 120000 })
    .catch(async (e) => { throw new Error(`${e.message}; panel: ${await page.textContent('[data-testid="tl-topology-panel"]')}`); });
  const done = await page.textContent('[data-testid="tl-topology-panel"]');
  assert(/Rebuild/.test(done), `link history built: ${done}`);
  await page.click('[data-testid="tl-links"]');
  await goTo(page, 0, LAST);
  await page.waitForTimeout(500);
  const first = await edgeCount(page);
  await goTo(page, LAST, LAST);
  await page.waitForTimeout(500);
  const head = await edgeCount(page);
  assert(head > 0, `links are drawn at the newest commit (${head})`);
  assert(first < head, `fewer links at the first commit (${first}) than at the newest (${head})`);
  await shot(ctx, 'tl-links-head');
  await goTo(page, 3, LAST);
  await page.click('[data-testid="tl-compare"]');
  await goTo(page, LAST, LAST);
  await page.waitForSelector('[data-testid="tl-compare-links"]');
  assert(/\+\d+ links/.test(await page.textContent('[data-testid="tl-compare-links"]')), 'compare shows the link change');
}

const dark = { colorScheme: 'dark' };
export const timelineScenarios = [
  { name: 'timeline: first, middle and HEAD match git ls-tree', run: eachCommitMatchesGit },
  { name: 'timeline: stepping and playing never move a card', run: nothingMoves },
  { name: 'timeline: deleted files ghost out, re-added ones enter, renames are one card', run: ghostsAndRenames },
  { name: 'timeline: zone chips show +N and empty zones hide', run: zoneChips },
  { name: 'timeline: keyboard, play / pause, speeds, stop at HEAD', run: keyboardAndPlayback },
  { name: 'timeline: growth chart and metric toggle', run: chartToggle },
  { name: 'timeline: compare two commits matches git diff', run: compareTwo },
  { name: 'timeline: loading history does not block the Map', run: loadingDoesNotBlock },
  { name: 'timeline: not a git repository / history too short', run: emptyStates },
  { name: 'timeline: reduced motion plays without entering animations', run: reducedMotion, contextOptions: { reducedMotion: 'reduce' } },
  { name: 'timeline: dark mode', run: darkMode, contextOptions: dark },
  { name: 'timeline: link history progress and cancel', run: linkHistoryCancel },
  { name: 'timeline: link history real build adds edges', run: linkHistoryReal },
];
