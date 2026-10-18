/**
 * Map v2 / M3 scenarios: "Group by Communities" on the messy monorepo fixture (packages/app has four topics whose
 * files are scattered across folders). Communities are detected from dependencies: leaf zones hold 5-40 files,
 * frames contain their cards, nothing overlaps, everything is in the viewport; the chip tooltip says "detected from
 * dependencies"; fewer cards per frame than Packages; the assignment is persisted to .flowlens/zone-state.json and
 * the same zone labels come back after a reload. Runs after the zone scenarios.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiConfig, assert, assertCleanLayout, settle, signIn } from './canvas-page.mjs';

async function shot(ctx, name) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `${name}.png`) });
}

async function commId(ctx) {
  const { daemon, token } = apiConfig();
  const res = await fetch(`${daemon}/api/projects/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: ctx.projects.comm.root, register: true }),
  });
  return (await res.json()).id;
}

async function openPackage(ctx, id) {
  await signIn(ctx.page, ctx.base, `#/p/${encodeURIComponent(id)}/map`);
  await ctx.page.waitForSelector('[data-testid="map-view"] .react-flow__node', { timeout: 60000 });
  await settle(ctx.page);
  await ctx.page.locator('.react-flow__node[data-id="package:packages/app"] [data-testid="zone-chip"]').dblclick();
  await settle(ctx.page);
}

const frames = (page) =>
  page.evaluate(() => {
    const rect = (el) => el.closest('.react-flow__node').getBoundingClientRect().toJSON();
    const fs = [...document.querySelectorAll('[data-testid="zone"][data-collapsed="false"]')].map((el) => ({
      id: el.closest('.react-flow__node').getAttribute('data-id'),
      label: el.querySelector('[data-testid="zone-chip"]')?.textContent ?? '',
      title: el.querySelector('[data-testid="zone-chip"]')?.getAttribute('title') ?? '',
      ...rect(el),
    }));
    const cs = [...document.querySelectorAll('[data-testid="file-card"]')].map((el) => ({ id: el.closest('.react-flow__node').getAttribute('data-id'), parent: el.getAttribute('data-parent'), ...rect(el) }));
    return { frames: fs, cards: cs };
  });

async function assertFramesHoldTheirCards(page, label) {
  const { frames: fs, cards } = await frames(page);
  const byId = new Map(fs.map((f) => [f.id, f]));
  for (const c of cards) {
    if (!c.parent) continue;
    const f = byId.get(c.parent);
    assert(f, `${label}: card ${c.id} has no frame ${c.parent}`);
    assert(c.x >= f.x - 1 && c.y >= f.y - 1 && c.right <= f.right + 1 && c.bottom <= f.bottom + 1, `${label}: card ${c.id} sticks out of ${f.id}`);
  }
  await assertCleanLayout(page, label);
  return { fs, cards };
}

const perFrame = (cards) => {
  const n = new Map();
  for (const c of cards) if (c.parent) n.set(c.parent, (n.get(c.parent) ?? 0) + 1);
  return n;
};

export const communityScenarios = [
  {
    name: 'communities: leaf zones hold 5-40 files, frames contain their cards, tooltip says detected from dependencies',
    async run(ctx) {
      const { page } = ctx;
      const id = await commId(ctx);
      await openPackage(ctx, id);
      await page.locator('[data-testid="group-by-packages"]').click();
      await settle(page);
      const before = await frames(page);
      const packagesMax = Math.max(0, ...perFrame(before.cards).values());
      await page.locator('[data-testid="group-by-communities"]').click();
      await settle(page);
      const { fs, cards } = await assertFramesHoldTheirCards(page, 'communities');
      await shot(ctx, '40-communities');
      assert(fs.length >= 3, `at least 3 community frames, got ${fs.length}: ${fs.map((f) => f.label)}`);
      const sizes = [...perFrame(cards).values()];
      assert(sizes.length >= 3 && sizes.every((n) => n >= 5 && n <= 40), `leaf zones hold 5-40 files: ${sizes}`);
      const max = Math.max(...sizes);
      assert(max <= packagesMax, `communities have no more cards per frame than packages (${max} vs ${packagesMax})`);
      const tips = fs.map((f) => f.title);
      assert(tips.some((t) => /detected from dependencies/.test(t)), `chip tooltip mentions the detection: ${tips[0]}`);
      assert(!tips.some((t) => /intended architecture/i.test(t)), 'communities are never called the intended architecture');
      const labels = fs.map((f) => f.label.replace(/\d+\s*$/, '').trim());
      assert(new Set(labels).size === labels.length, `sibling labels are unique: ${labels}`);
      ctx.labels = labels.sort();
    },
  },
  {
    name: 'communities: the assignment is saved to zone-state.json and the same zones come back after a reload',
    async run(ctx) {
      const { page } = ctx;
      const id = await commId(ctx);
      await openPackage(ctx, id);
      await page.locator('[data-testid="group-by-communities"]').click();
      await settle(page);
      const first = (await frames(page)).frames.map((f) => f.label.replace(/\d+\s*$/, '').trim()).sort();
      const file = join(ctx.projects.comm.root, '.flowlens', 'zone-state.json');
      for (let i = 0; i < 40 && !existsSync(file); i++) await page.waitForTimeout(250); // debounce is 1.5 s
      assert(existsSync(file), 'zone-state.json is written after the debounce');
      const state = JSON.parse(readFileSync(file, 'utf8'));
      const paths = Object.keys(state.assignment);
      assert(state.version === 1 && paths.length >= 30, `assignment lists the clustered files: ${paths.length}`);
      assert(paths.every((p) => !p.startsWith('/') && !p.includes('..')), 'paths are project-relative');
      await page.reload();
      await page.waitForSelector('[data-testid="map-view"] .react-flow__node', { timeout: 60000 });
      await settle(page);
      // The hash keeps the package open after a reload; open it only when the reload landed on the project.
      const chip = page.locator('.react-flow__node[data-id="package:packages/app"] [data-testid="zone-chip"]');
      if (await chip.count()) {
        await chip.dblclick();
        await settle(page);
      }
      await page.locator('[data-testid="group-by-communities"]').click();
      await settle(page);
      const second = (await frames(page)).frames.map((f) => f.label.replace(/\d+\s*$/, '').trim()).sort();
      assert(JSON.stringify(first) === JSON.stringify(second), `labels are stable across a reload: ${first} vs ${second}`);
      await shot(ctx, '41-communities-reloaded');
    },
  },
];
