/**
 * Plain-English glossary — every user-facing health string uses these
 * phrases instead of the engineering term. Tests scan titles and
 * "why it matters" text for BANNED_JARGON.
 */

export const GLOSSARY: Record<string, string> = {
  'cognitive complexity': 'hard to follow',
  'cyclomatic complexity': 'number of paths through the code',
  'afferent coupling': 'how many places depend on this',
  'efferent coupling': 'how many other files this one depends on',
  instability: 'how easily this is affected by changes elsewhere',
  cycle: 'tangle: files that depend on each other in a loop',
  'circular dependency': 'tangle: files that depend on each other in a loop',
  'strongly connected component': 'group of tangled files',
  'god class': 'a file doing too many jobs',
  'god file': 'a file doing too many jobs',
  hub: 'a file many other files rely on',
  hotspot: 'hard-to-follow code that changes often',
  churn: 'how often a file changes',
  'architecture violation': 'code reaching into a part it should not use',
  layer: 'part of the app (for example UI, services, data)',
  'blast radius': 'how many files could break if this changes',
  'transitive dependents': 'files that rely on this directly or indirectly',
  'dead code': 'code that nothing seems to use',
  'unresolved import': 'an import FlowLens could not connect to a file',
};

/** Terms that must never appear in titles or "why it matters" text. */
export const BANNED_JARGON: string[] = [
  'cognitive complexity',
  'cyclomatic',
  'afferent',
  'efferent',
  'coupling',
  'instability',
  'strongly connected',
  'scc',
  'tarjan',
  'pagerank',
  'transitive',
  'fan-in',
  'fan-out',
  'halstead',
  'cohesion',
  'wmc',
  'atfd',
  'god class',
  'churn',
  'refactor',
];

/** Return the banned terms found in `text` (case-insensitive, whole words). */
export function findJargon(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_JARGON.filter((term) => {
    const re = new RegExp(`(^|[^a-z])${term.replace(/[-]/g, '\\-')}([^a-z]|$)`);
    return re.test(lower);
  });
}

/** "1 file" / "3 files". */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/** Shorten a path for titles: keep the last two segments. */
export function shortPath(file: string): string {
  const parts = file.split('/');
  return parts.length <= 2 ? file : `…/${parts.slice(-2).join('/')}`;
}

/** Clamp a title to 80 characters. */
export function clampTitle(title: string, max = 80): string {
  return title.length <= max ? title : `${title.slice(0, max - 1)}…`;
}

/** Plain-English label for a complexity number. */
export function complexityWords(score: number): string {
  if (score > 50) return 'extremely hard to follow';
  if (score > 25) return 'very hard to follow';
  return 'hard to follow';
}
