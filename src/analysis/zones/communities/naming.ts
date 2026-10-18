/**
 * Naming communities (a name is only a label — keys decide identity).
 *
 * In order: the common folder prefix of all files, relative to the enclosing package / zone, without
 * generic folders (`src`, `lib`…) and at most its last two segments (`adapters/codex`); otherwise the
 * top TF-IDF words of the file and symbol names (`session · parse`). Siblings never share a label:
 * a clash is resolved by appending the next distinctive word to every clashing zone, a number only
 * when the words run out.
 */
import { compareText } from '../keys.js';

export interface NameFile {
  path: string;
  tokens: ReadonlyMap<string, number>;
}

export interface NameRequest {
  files: readonly NameFile[];
  /** Label that must be kept (the community matched an earlier key). */
  fixed?: string;
}

const GENERIC_DIRS: ReadonlySet<string> = new Set(['src', 'lib', 'source', 'sources', 'main', 'java', 'kotlin', 'scala', 'app', 'dist']);
const SEP = ' · ';

export const dirSegments = (path: string): string[] => path.split('/').slice(0, -1);

export function commonPrefix(files: readonly { path: string }[]): string[] {
  if (files.length === 0) return [];
  let prefix = dirSegments(files[0].path);
  for (const f of files) {
    const segs = dirSegments(f.path);
    let i = 0;
    while (i < prefix.length && i < segs.length && prefix[i] === segs[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

/** Display prefix: relative to `baseSegs`, generic leading folders dropped, last two segments. */
export function displayPrefix(prefix: string[], baseSegs: readonly string[]): string {
  let rest = prefix;
  if (baseSegs.length > 0 && baseSegs.every((s, i) => prefix[i] === s)) rest = prefix.slice(baseSegs.length);
  let i = 0;
  while (i < rest.length && GENERIC_DIRS.has(rest[i].toLowerCase())) i++;
  return rest.slice(i).slice(-2).join('/');
}

/**
 * Words ranked by tf·idf, idf over the sibling communities (a word every sibling has scores 0). A word
 * found in a single file of a community with several files is a weak name and is demoted.
 */
export function rankTokens(reqs: readonly NameRequest[]): string[][] {
  const tf = reqs.map((r) => {
    const m = new Map<string, { w: number; files: number }>();
    for (const f of r.files) {
      for (const [t, w] of f.tokens) {
        const e = m.get(t) ?? { w: 0, files: 0 };
        m.set(t, { w: e.w + w, files: e.files + 1 });
      }
    }
    return m;
  });
  const df = new Map<string, number>();
  for (const m of tf) for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  return tf.map((m, i) =>
    [...m]
      .map(([t, e]) => {
        const support = reqs[i].files.length >= 4 && e.files < 2 ? 0.2 : 1;
        return [t, e.w * support * (Math.log(1 + reqs.length / df.get(t)!) - Math.LN2)] as const;
      })
      .filter(([, score]) => score > 1e-9)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([t]) => t),
  );
}

/** Unique labels for sibling communities (`baseSegs`: folder segments already implied by the parent). */
export function nameSiblings(reqs: readonly NameRequest[], baseSegs: readonly string[]): string[] {
  const ranked = rankTokens(reqs);
  const names: string[] = reqs.map((r, i) => {
    if (r.fixed !== undefined) return r.fixed;
    const prefix = displayPrefix(commonPrefix(r.files), baseSegs);
    if (prefix) return prefix;
    return ranked[i].slice(0, 2).join(SEP) || 'misc';
  });
  const extras = reqs.map((_, i) => ranked[i].filter((t) => !names[i].toLowerCase().split(/[ ·/]+/).includes(t)));
  const used = new Array<number>(reqs.length).fill(0);
  const lower = (s: string): string => s.toLowerCase();
  for (let round = 0; round < 8; round++) {
    const seen = new Map<string, number[]>();
    names.forEach((n, i) => seen.set(lower(n), [...(seen.get(lower(n)) ?? []), i]));
    let changed = false;
    for (const group of seen.values()) {
      if (group.length < 2) continue;
      for (const i of group) {
        if (reqs[i].fixed !== undefined) continue; // fixed labels win; the others move
        const next = extras[i][used[i]++];
        if (next !== undefined) {
          names[i] += SEP + next;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  // Still clashing (words ran out): number the later ones, in a stable order.
  const taken = new Set<string>();
  const order = names.map((_, i) => i).sort((a, b) => (reqs[a].fixed !== undefined ? 0 : 1) - (reqs[b].fixed !== undefined ? 0 : 1) || compareText(names[a], names[b]) || a - b);
  for (const i of order) {
    let name = names[i];
    for (let n = 2; taken.has(lower(name)); n++) name = `${names[i]} ${n}`;
    names[i] = name;
    taken.add(lower(name));
  }
  return names;
}

/** `adapters · parse` ↔ `adapters+parse`, `adapters/codex` ↔ `adapters~codex`: the key keeps the label recoverable. */
export function slugOf(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/ · /g, '+')
    .replace(/\//g, '~')
    .replace(/[^a-z0-9._@~+-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'zone';
}

export const labelOfSlug = (slug: string): string => slug.replace(/\+/g, SEP).replace(/~/g, '/');
