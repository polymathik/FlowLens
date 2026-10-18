/**
 * Program entry points that are not declared in a manifest:
 *  - a function called `main` (Go, Rust, C/C++, Java/Kotlin/C#, Python, TS/JS);
 *  - "run when executed directly" guards: `require.main === module`,
 *    `import.meta.main`, `import.meta.url === …argv[1]…`,
 *    `if __name__ == '__main__':`.
 */
import type { EntryPoint } from '../../contracts/flow.js';
import { lineAt } from '../source.js';
import { baseOf, makeEntry, type DetectContext } from './types.js';

const STRICT_MAIN = new Set(['go', 'rust', 'c', 'cpp', 'java', 'kotlin', 'csharp', 'swift', 'scala']);
const GUARD_JS = /require\.main\s*===\s*module|import\.meta\.main\b|import\.meta\.url\s*===?\s*[^\n]*argv\s*\[\s*1\s*\]|process\.argv\s*\[\s*1\s*\][^\n]*import\.meta\.url/;
const GUARD_PY = /^if\s+__name__\s*==\s*['"]__main__['"]\s*:/m;

export function detectMainFunctions(ctx: DetectContext): EntryPoint[] {
  const { graph } = ctx;
  const out: EntryPoint[] = [];
  for (const f of graph.sourceFiles()) {
    if (graph.isTestFile(f.file)) continue;
    const mains = (graph.byFile.get(f.file) ?? []).filter((e) => (e.kind === 'function' || e.kind === 'method') && e.name === 'main');
    for (const e of mains) {
      const top = e.qualified_name === `${f.file}/main`;
      const strict = STRICT_MAIN.has(e.language);
      if (!top && !(strict && e.kind === 'method')) continue;
      out.push(makeEntry({
        entity: e, kind: 'main', label: `main: ${baseOf(f.file)}`, confidence: strict ? 0.9 : 0.7,
        evidence: `function named main in ${e.language} source${top ? '' : ' (static class method)'}`,
      }));
    }
    if (mains.length > 0) continue;
    const src = /^(?:typescript|javascript|tsx|jsx|python)$/.test(f.language) ? ctx.source(f.file) : null;
    const re = f.language === 'python' ? GUARD_PY : GUARD_JS;
    const m = src ? re.exec(src.text) : null;
    if (src && m) {
      out.push(makeEntry({
        entity: f, line: lineAt(src.starts, m.index), kind: 'main', label: `main: ${baseOf(f.file)}`, confidence: 0.85,
        evidence: f.language === 'python' ? "`if __name__ == '__main__'` guard" : 'runs only when executed directly (require.main / import.meta guard)',
      }));
    }
  }
  return out;
}
