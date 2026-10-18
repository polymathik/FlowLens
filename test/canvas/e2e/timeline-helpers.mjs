/**
 * Helpers of the timeline E2E scenarios: register the git fixtures, open the Map and its timeline, read what the
 * bar and the cards show, and compute the truth from git itself (`git ls-tree` / `git diff`) to compare against.
 */
import { execFileSync } from 'node:child_process';
import { apiConfig, assert, settle, signIn } from './canvas-page.mjs';

const cache = new Map();

export async function register(root) {
  const { daemon, token } = apiConfig();
  const res = await fetch(`${daemon}/api/projects/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, register: true }),
  });
  return (await res.json()).id;
}

const git = (root, ...args) => execFileSync('git', args, { cwd: root, maxBuffer: 1 << 26 }).toString();

/** The mainline history the timeline loads, plus every path it ever mentions (the filter git's raw tree is cut with). */
export async function truthFor(root) {
  if (cache.has(root)) return cache.get(root);
  const id = await register(root);
  const { daemon, token } = apiConfig();
  const res = await fetch(`${daemon}/api/projects/${id}/canvas/history?first_parent=1`, { headers: { Authorization: `Bearer ${token}` } });
  const history = await res.json();
  const ever = new Set();
  for (const c of history.commits) for (const f of c.files) { ever.add(f.path); if (f.from) ever.add(f.from); }
  const t = {
    id, history, ever,
    /** Files in the tree of commit `i` that the Map shows (git's list, cut to the paths the history knows). */
    files: (i) => git(root, 'ls-tree', '-r', '--name-only', history.commits[i].sha).split('\n').filter((p) => p && ever.has(p)),
    diff: (a, b) => {
      const out = { added: [], removed: [], changed: [] };
      for (const line of git(root, 'diff', '--name-status', '-M', history.commits[a].sha, history.commits[b].sha).split('\n').filter(Boolean)) {
        const [status, ...paths] = line.split('\t');
        const path = paths[paths.length - 1];
        if (!ever.has(path) && !ever.has(paths[0])) continue;
        (status === 'A' ? out.added : status === 'D' ? out.removed : out.changed).push(path);
      }
      return out;
    },
  };
  cache.set(root, t);
  return t;
}

export const isConfigFile = (p) => /(^|\/)(package\.json|tsconfig\.json)$/.test(p);

export async function openTimeline(ctx, projectId, { wait = true } = {}) {
  const { page } = ctx;
  await signIn(page, ctx.base, `#/p/${encodeURIComponent(projectId)}/map`);
  await page.waitForSelector('[data-testid="map-view"] .react-flow__node', { timeout: 60000 });
  await settle(page);
  await page.click('[data-testid="timeline-button"]');
  if (wait) {
    await page.waitForSelector('[data-testid="tl-bar"]', { timeout: 30000 });
    await settle(page, { quietMs: 1300 }); // ghost layout, then the refit
  }
}

export const bar = (page) => page.$eval('[data-testid="tl-bar"]', (e) => ({ ...e.dataset, index: Number(e.dataset.index), files: Number(e.dataset.files), cards: Number(e.dataset.cards) }));

/** Move the playhead to commit `i` with the keyboard (Home, then → i times). */
export async function goTo(page, i, last) {
  await page.locator('[data-testid="tl-slider"]').focus();
  if (i === last) await page.keyboard.press('End');
  else {
    await page.keyboard.press('Home');
    for (let k = 0; k < i; k++) await page.keyboard.press('ArrowRight');
  }
  await page.waitForFunction((n) => document.querySelector('[data-testid="tl-bar"]')?.dataset.index === String(n), i);
  await page.waitForTimeout(450); // fades
}

/** Node ids of the file cards that are alive (neither absent nor ghosts) / are ghosts. */
export const cardsByState = (page) =>
  page.$$eval('[data-testid="file-card"]', (els) => {
    const out = { live: [], ghost: [], absent: [] };
    for (const e of els) {
      const w = e.closest('.react-flow__node');
      const id = w.getAttribute('data-id');
      (/fl-tl-absent/.test(w.className) ? out.absent : /fl-tl-ghost/.test(w.className) ? out.ghost : out.live).push(id);
    }
    return out;
  });

export const nodeClass = (page, id) => page.$eval(`.react-flow__node[data-id="${id}"]`, (e) => e.className).catch(() => null);

/** Rounded rectangles of every node (hidden ones too). */
export const rects = (page) =>
  page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('.react-flow__node')].map((n) => {
      const r = n.getBoundingClientRect();
      return [n.getAttribute('data-id'), [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(',')];
    })));

export async function shot(ctx, name) {
  if (ctx.shots) await ctx.page.screenshot({ path: `${ctx.shots}/${name}.png` });
}

export { assert, settle };
