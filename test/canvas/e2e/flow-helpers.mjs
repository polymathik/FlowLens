/**
 * Helpers of the Flow mode E2E scenarios: opening a flow, waiting for it to settle, the REST trace to compare
 * against, and the "clean layout" assertion scoped to the flow canvas (the Map stays mounted underneath).
 */
import { apiConfig, assert, signIn } from './canvas-page.mjs';

export const CANVAS = '[data-testid="flow-canvas"]';
export const hash = (page) => page.evaluate(() => window.location.hash);
export const flowLink = (id, entity, query = '') => `#/p/${encodeURIComponent(id)}/map/flow/${encodeURIComponent(entity)}${query}`;
export const card = (page, text) => page.locator('[data-testid="flow-card"]', { hasText: text }).first();
export const count = (page, sel) => page.locator(`${CANVAS} ${sel}`).count();

/** Wait until no flow node moves for `quietMs` (layout + fit animation done) and nothing is loading. */
export async function settleFlow(page, { quietMs = 600, timeoutMs = 25000 } = {}) {
  const start = Date.now();
  let prev = '';
  let since = Date.now();
  while (Date.now() - start < timeoutMs) {
    const cur = await page.evaluate((sel) => {
      const root = document.querySelector(sel);
      const loading = document.querySelector('[data-testid="flow-view"]')?.getAttribute('data-loading');
      const vp = root?.querySelector('.react-flow__viewport');
      const nodes = [...(root?.querySelectorAll('.react-flow__node') ?? [])].map((n) => `${n.getAttribute('data-id')}@${n.style.transform}`);
      return `${loading}|${vp?.style.transform}|${nodes.join(';')}`;
    }, CANVAS);
    if (cur !== prev) {
      prev = cur;
      since = Date.now();
    } else if (Date.now() - since >= quietMs && cur.startsWith('0|')) return;
    await page.waitForTimeout(100);
  }
  throw new Error('flow did not settle');
}

export async function openMap(ctx, id, tail = '') {
  await signIn(ctx.page, ctx.base, `#/p/${encodeURIComponent(id)}/map${tail}`);
  await ctx.page.waitForSelector('[data-testid="map-view"] .react-flow__node', { timeout: 60000 });
}

export async function openFlow(ctx, id, entity, query = '') {
  await signIn(ctx.page, ctx.base, flowLink(id, entity, query));
  await ctx.page.waitForSelector('[data-testid="flow-view"]', { timeout: 60000 });
  await ctx.page.waitForSelector(`${CANVAS} [data-testid="flow-card"]`, { timeout: 60000 });
  await settleFlow(ctx.page);
}

/** The REST trace the view must agree with (`entity` = what the link names). */
export async function trace(id, entity, params = {}) {
  const { daemon, token } = apiConfig();
  const q = new URLSearchParams({ entity, depth: '4', ...params });
  const res = await fetch(`${daemon}/api/projects/${encodeURIComponent(id)}/canvas/flow/trace?${q}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}
export async function entryPoints(id, query = '') {
  const { daemon, token } = apiConfig();
  const res = await fetch(`${daemon}/api/projects/${encodeURIComponent(id)}/canvas/flow/entry-points?max=1000${query}`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

/** Cards, hops and lanes the picture must have for a trace: one card per node plus one leaf per hop without a node at its far end. */
export function expectedCounts(t) {
  const ids = new Set(t.nodes.map((n) => n.id));
  const far = (h) => (t.direction === 'out' ? h.to : h.from);
  const leaves = t.hops.filter((h) => !far(h) || !ids.has(far(h))).length;
  return { cards: t.nodes.length + leaves, hops: t.hops.length, lanes: t.lanes.filter((l) => l.nodeIds.length > 0).length };
}

export async function assertCounts(page, t, label) {
  const want = expectedCounts(t);
  const got = { cards: await count(page, '[data-testid="flow-card"]'), hops: await count(page, '[data-testid="flow-edge"]'), lanes: await count(page, '[data-testid="flow-lane"]') };
  assert(JSON.stringify(got) === JSON.stringify(want), `${label}: picture ${JSON.stringify(got)} but the REST trace says ${JSON.stringify(want)}`);
  const attrs = await page.getAttribute('[data-testid="flow-view"]', 'data-cards');
  assert(Number(attrs) === want.cards, `${label}: data-cards ${attrs}`);
}

/** Every flow node inside the pane; cards neither overlap each other nor leave their lane band. */
export async function assertFlowClean(page, label) {
  const { pane, cards, lanes } = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const rect = (el) => el.getBoundingClientRect().toJSON();
    const pane = rect(root.querySelector('.react-flow'));
    const cards = [...root.querySelectorAll('.react-flow__node[data-id]')].filter((n) => n.querySelector('[data-testid="flow-card"]')).map((n) => ({ id: n.getAttribute('data-id'), ...rect(n), lane: n.querySelector('[data-testid="flow-card"]').getAttribute('data-lane') }));
    const lanes = [...root.querySelectorAll('[data-testid="flow-lane"]')].map((l) => ({ id: l.getAttribute('data-lane-id'), ...rect(l.closest('.react-flow__node')) }));
    return { pane, cards, lanes };
  }, CANVAS);
  const inside = (r, p) => r.x >= p.x - 1 && r.y >= p.y - 1 && r.x + r.width <= p.x + p.width + 1 && r.y + r.height <= p.y + p.height + 1;
  for (const r of [...cards, ...lanes]) assert(inside(r, pane), `${label}: ${r.id} outside the viewport ${JSON.stringify(r)} / ${JSON.stringify(pane)}`);
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i];
      const b = cards[j];
      assert(!(a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1), `${label}: cards ${a.id} and ${b.id} overlap`);
    }
    const lane = lanes.find((l) => l.id === cards[i].lane);
    const c = cards[i];
    assert(lane && c.x >= lane.x - 1 && c.y >= lane.y - 1 && c.x + c.width <= lane.x + lane.width + 1 && c.y + c.height <= lane.y + lane.height + 1, `${label}: card ${c.id} outside its lane ${cards[i].lane}`);
  }
  return cards.length;
}

export const states = (page, sel) => page.$$eval(`${CANVAS} ${sel}`, (els) => els.map((e) => e.getAttribute('data-state')));
export const tally = (list) => list.reduce((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {});

