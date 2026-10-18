/** Test files as entry points (kind `test`; excluded from listings and traces unless asked for). */
import type { EntryPoint } from '../../contracts/flow.js';
import { baseOf, makeEntry, type DetectContext } from './types.js';

const CODE = /^(?:typescript|javascript|tsx|jsx|python|go|rust|java|kotlin|csharp|ruby|php|swift|scala|svelte|vue)$/;

export function detectTestEntries(ctx: DetectContext): EntryPoint[] {
  const out: EntryPoint[] = [];
  for (const f of ctx.graph.sourceFiles()) {
    if (!ctx.graph.isTestFile(f.file) || !CODE.test(f.language)) continue;
    out.push(makeEntry({
      entity: f, line: 1, kind: 'test', label: `test: ${baseOf(f.file)}`, confidence: 0.9,
      evidence: 'file classified as a test (path/name convention)',
    }));
  }
  return out;
}
