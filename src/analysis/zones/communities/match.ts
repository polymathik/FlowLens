/**
 * Keeping keys across edits (warm start): match each new community to the previous key it shares the
 * most files with. A key is reused when the overlap is at least half of the new community OR half of the
 * old one, and each key is used once (largest overlap first), so splits keep the key on the bigger half
 * and merges keep the key of the bigger part.
 */

/** The child of `parentKey` that a previous leaf key belongs to (`P/a/b` under `P` → `P/a`). */
export function childOf(parentKey: string, leaf: string | undefined): string | undefined {
  if (leaf === undefined || !leaf.startsWith(`${parentKey}/`)) return undefined;
  const seg = leaf.slice(parentKey.length + 1).split('/')[0];
  return seg ? `${parentKey}/${seg}` : undefined;
}

/** How many files the previous assignment had in each child of `parentKey`. */
export function previousSizes(parentKey: string, assignment: Readonly<Record<string, string>>): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const leaf of Object.values(assignment)) {
    const c = childOf(parentKey, leaf);
    if (c) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  }
  return sizes;
}

/**
 * `groups[i]` are the new communities' previous child keys per file (undefined for new files);
 * returns the key to keep per group, or null for a group that is new.
 */
export function matchKeys(groups: ReadonlyArray<ReadonlyArray<string | undefined>>, sizes: ReadonlyMap<string, number>): Array<string | null> {
  const cands: Array<{ g: number; key: string; overlap: number; share: number }> = [];
  groups.forEach((labels, g) => {
    const counts = new Map<string, number>();
    for (const l of labels) if (l !== undefined) counts.set(l, (counts.get(l) ?? 0) + 1);
    for (const [key, overlap] of counts) {
      const old = sizes.get(key) ?? overlap;
      if (overlap / labels.length >= 0.5 || overlap / old >= 0.5) cands.push({ g, key, overlap, share: overlap / labels.length });
    }
  });
  cands.sort((a, b) => b.overlap - a.overlap || b.share - a.share || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || a.g - b.g);
  const out: Array<string | null> = groups.map(() => null);
  const taken = new Set<string>();
  for (const c of cands) {
    if (out[c.g] !== null || taken.has(c.key)) continue;
    out[c.g] = c.key;
    taken.add(c.key);
  }
  return out;
}
