/**
 * Page helpers for the canvas E2E scenarios.
 */
export function assert(cond, message) {
  if (!cond) throw new Error(`assertion failed: ${message}`);
}

const nodeSel = (id) => `.react-flow__node[data-id="${id}"]`;

/** Wait until no node moves for `quietMs` (layout + fit animation done). */
export async function settle(page, { quietMs = 700, timeoutMs = 20000 } = {}) {
  const start = Date.now();
  let prev = '';
  let since = Date.now();
  while (Date.now() - start < timeoutMs) {
    const cur = await page.evaluate(() => {
      const vp = document.querySelector('.react-flow__viewport');
      const nodes = [...document.querySelectorAll('.react-flow__node')].map((n) => `${n.getAttribute('data-id')}@${n.style.transform}`);
      return `${vp?.style.transform}|${nodes.join(';')}`;
    });
    if (cur !== prev) {
      prev = cur;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) {
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error('canvas did not settle');
}

/** Explorer session config set by run.mjs: map project + bearer for API reads. */
const cfg = { projectId: '', daemon: '', token: '' };
export function configureExplorer(c) {
  Object.assign(cfg, c);
}

/** Sign this browser context in (one-time code → cookie) and land on `hash`. */
export async function signIn(page, base, hash = '#/home') {
  const res = await fetch(`${cfg.daemon}/api/auth/code`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect: hash }),
  });
  const { code } = await res.json();
  await page.goto(`${base}/auth?t=${encodeURIComponent(code)}`);
}

/** Map a single-project canvas hash ('' | '#/entity/…') onto project A's map tab. */
export function mapHash(hash = '', projectId = cfg.projectId) {
  const rest = hash.replace(/^#\/?/, '');
  return `#/p/${encodeURIComponent(projectId)}/map${rest ? `/${rest}`.replace('/?', '?') : ''}`;
}

export async function openCanvas(page, base, hash = '') {
  await signIn(page, base, mapHash(hash));
  await page.waitForSelector('.react-flow__node', { timeout: 60000 });
  await settle(page);
}

export async function nodeIds(page) {
  return page.$$eval('.react-flow__node', (els) => els.map((e) => e.getAttribute('data-id')));
}

export async function edgeCount(page, cls = '') {
  return page.$$eval(`.react-flow__edge${cls}`, (els) => els.length);
}

export async function dblclickNode(page, id) {
  await page.locator(nodeSel(id)).dblclick();
  await settle(page);
}

export async function clickNode(page, id) {
  await page.locator(nodeSel(id)).click();
}

export async function nodeOverlay(page, id) {
  return page.$eval(`${nodeSel(id)} .flowlens-node`, (el) => ({
    tag: el.getAttribute('data-overlay'),
    background: getComputedStyle(el).backgroundColor,
    border: getComputedStyle(el).borderTopColor,
  }));
}

/** Bounding boxes of every rendered node and of the flow pane. */
export async function layoutBoxes(page) {
  return page.evaluate(() => {
    const pane = document.querySelector('.react-flow').getBoundingClientRect();
    const nodes = [...document.querySelectorAll('.react-flow__node')].map((n) => {
      const r = n.getBoundingClientRect();
      return { id: n.getAttribute('data-id'), x: r.x, y: r.y, w: r.width, h: r.height };
    });
    return { pane: { x: pane.x, y: pane.y, w: pane.width, h: pane.height }, nodes };
  });
}

export function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Every node fully inside the pane and no two nodes overlapping. */
export async function assertCleanLayout(page, label) {
  const { pane, nodes } = await layoutBoxes(page);
  for (const n of nodes) {
    const inside = n.x >= pane.x - 1 && n.y >= pane.y - 1 && n.x + n.w <= pane.x + pane.w + 1 && n.y + n.h <= pane.y + pane.h + 1;
    assert(inside, `${label}: node ${n.id} off-screen ${JSON.stringify(n)} pane ${JSON.stringify(pane)}`);
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      assert(!overlaps(nodes[i], nodes[j]), `${label}: ${nodes[i].id} overlaps ${nodes[j].id}`);
    }
  }
  return nodes.length;
}

/** Read the project's canvas API (`api` = …/api/projects/<id>/canvas) with the CLI token. */
export async function apiJson(api, path) {
  const res = await fetch(`${api}${path}`, { headers: { Authorization: `Bearer ${cfg.token}` } });
  return res.json();
}

/** Pixel standard deviation of a PNG (data URL) decoded in the browser. */
export async function pngStats(page, base64) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let sum = 0;
    let sumSq = 0;
    let nonWhite = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += lum;
      sumSq += lum * lum;
      if (lum < 245) nonWhite++;
    }
    const mean = sum / n;
    return { width: img.width, height: img.height, std: Math.sqrt(sumSq / n - mean * mean), nonWhiteRatio: nonWhite / n };
  }, base64);
}
