/**
 * Rules: god files (a file doing too many jobs) and very long files.
 *
 * God file ≈ Lanza–Marinescu God Class adapted to files: long (≥ 400
 * lines) AND either lots of logic (summed function complexity ≥ 47, their
 * WMC bar) or lots of functions (≥ 25). A file that is only long is a
 * `large_file`. Dedupe: a god file never also gets a large-file finding,
 * and a god file's points are always ≥ the large-file points it replaces.
 * Lockfiles, generated/minified output and data files (JSON, YAML, …) are
 * never judged by size (see file-kinds.ts).
 */
import type { HealthSeverity } from '../../contracts/health.js';
import type { HealthContext } from '../context.js';
import { buildFinding, buildFixPrompt, makeFocus, type HealthRule, type RawFinding } from '../finding.js';
import { plural, shortPath } from '../glossary.js';
import { isSizeJudged } from '../file-kinds.js';

export interface FileSize {
  lines: number;
  functions: number;
  totalComplexity: number;
}

export function measureFile(ctx: HealthContext, file: string): FileSize {
  const fns = ctx.functionsIn(file);
  const totalComplexity = fns.reduce((s, e) => s + (ctx.complexity(e)?.value ?? 0), 0);
  return { lines: ctx.lineCount(file), functions: fns.length, totalComplexity };
}

export function isGodFile(ctx: HealthContext, s: FileSize): boolean {
  const t = ctx.thresholds.size;
  return s.lines >= t.god_file_lines && (s.totalComplexity >= t.god_file_total_complexity || s.functions >= t.god_file_functions);
}

export const sizeRule: HealthRule = {
  kind: 'god_file',
  run(ctx) {
    const out: RawFinding[] = [];
    for (const file of ctx.files) {
      if (!isSizeJudged(file, languageOf(ctx, file))) continue;
      const s = measureFile(ctx, file);
      if (isGodFile(ctx, s)) out.push(godFinding(ctx, file, s));
      else if (s.lines > ctx.thresholds.size.large_file_lines) out.push(largeFinding(ctx, file, s));
    }
    return out;
  },
};

function languageOf(ctx: HealthContext, file: string): string | undefined {
  const ents = ctx.entitiesByFile.get(file) ?? [];
  return (ents.find((e) => e.kind === 'file') ?? ents[0])?.language;
}

function godFinding(ctx: HealthContext, file: string, s: FileSize): RawFinding {
  const severity: HealthSeverity = s.lines > 1000 || s.totalComplexity > 150 ? 'critical' : 'high';
  const dependents = ctx.fileDependents.get(file)?.size ?? 0;
  const names = ctx
    .functionsIn(file)
    .slice(0, 15)
    .map((e) => e.name);
  return buildFinding(ctx, {
    kind: 'god_file',
    category: 'size',
    target: file,
    severity,
    title: `${shortPath(file)} looks like it is doing too many jobs`,
    why:
      `It is ${s.lines} lines long with ${plural(s.functions, 'function')} and a lot of logic in one place. ` +
      'Big mixed-purpose files are hard for people and AI assistants to change without side effects.',
    evidence: [{ file, numbers: { lines: s.lines, functions: s.functions, total_complexity: s.totalComplexity, dependents } }],
    focus: makeFocus(ctx, { kind: 'file', identifier: file, overlay: 'complexity', files: [file] }),
    prompt: buildFixPrompt({
      goal: `Split ${file} into a few smaller files, each with one clear purpose.`,
      files: [{ file, note: `${s.lines} lines, ${plural(s.functions, 'function')}` }],
      facts: [
        `${file} has ${s.lines} lines, ${plural(s.functions, 'function')} and a combined complexity score of ${s.totalComplexity}.`,
        `${plural(dependents, 'file')} import it directly.`,
        names.length > 0 ? `Functions include: ${names.join(', ')}.` : 'It defines many symbols.',
      ],
      steps: [
        'Group the functions by what they are about (for example dates, money, formatting, API calls) and show me the groups before moving anything.',
        `Move one group at a time into its own file next to ${file}. Keep ${file} re-exporting the moved functions so existing imports keep working.`,
        'Stop after the first group so I can review.',
      ],
    }),
    effort: 'L',
    impactFiles: [file],
  });
}

function largeFinding(ctx: HealthContext, file: string, s: FileSize): RawFinding {
  const severity: HealthSeverity = s.lines > 1000 ? 'high' : 'medium';
  return buildFinding(ctx, {
    kind: 'large_file',
    category: 'size',
    target: file,
    severity,
    title: `${shortPath(file)} is very long (${s.lines} lines)`,
    why:
      `Files over ${ctx.thresholds.size.large_file_lines} lines are hard to read in one go, and AI assistants ` +
      'often lose track of parts of them when editing.',
    evidence: [{ file, numbers: { lines: s.lines, functions: s.functions } }],
    focus: makeFocus(ctx, { kind: 'file', identifier: file, files: [file] }),
    prompt: buildFixPrompt({
      goal: `Make ${file} shorter by moving self-contained parts into their own files.`,
      files: [{ file, note: `${s.lines} lines` }],
      facts: [`${file} is ${s.lines} lines long with ${plural(s.functions, 'function')}.`],
      steps: [
        'Find parts that stand on their own (constants, data tables, UI sub-components, helper functions) and list them for me first.',
        `Move them into new files next to ${file} and import them back.`,
      ],
    }),
    effort: 'M',
    impactFiles: [file],
  });
}
