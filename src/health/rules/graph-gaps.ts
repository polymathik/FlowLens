/**
 * Rules that only inform (severity 'info', zero penalty): files nothing
 * seems to use, and imports FlowLens could not connect. They are not
 * scored because static analysis cannot see dynamic loading, framework
 * routing or generated code — and because counting them would let adding
 * a dependency *improve* the score (breaking monotonicity).
 */
import { ENTRY_POINT_PATTERNS } from '../config.js';
import type { HealthContext } from '../context.js';
import { buildFinding, buildFixPrompt, makeFocus, type HealthRule } from '../finding.js';
import { plural, shortPath } from '../glossary.js';
import { importsTrustworthy, measureGraphQuality } from '../graph-quality.js';

export const orphanRule: HealthRule = {
  kind: 'orphan_module',
  run(ctx) {
    if (ctx.files.length < ctx.thresholds.graph.orphan_min_files) return [];
    if (!importsTrustworthy(ctx, measureGraphQuality(ctx))) return [];
    const orphans = ctx.files.filter(
      (f) =>
        (ctx.fileDeps.get(f)?.size ?? 0) === 0 &&
        (ctx.fileDependents.get(f)?.size ?? 0) === 0 &&
        !ENTRY_POINT_PATTERNS.some((re) => re.test(f)),
    );
    if (orphans.length === 0) return [];
    return [
      buildFinding(ctx, {
        kind: 'orphan_module',
        category: 'structure',
        target: 'orphans',
        severity: 'info',
        title:
          orphans.length === 1
            ? `${shortPath(orphans[0])} looks unused`
            : `${plural(orphans.length, 'file')} look unused`,
        why:
          'Nothing in the project seems to use these files, and they use nothing else. They may be leftovers from ' +
          'earlier attempts, which confuse people and AI assistants reading the code. (Files loaded by name at runtime can look unused too.)',
        evidence: orphans.slice(0, 20).map((file) => ({ file, numbers: { lines: ctx.lineCount(file) } })),
        focus: makeFocus(ctx, { kind: 'file', identifier: orphans[0], files: orphans }),
        prompt: buildFixPrompt({
          goal: 'Find out whether these files are still needed, and remove the ones that are not.',
          files: orphans.slice(0, 20).map((file) => ({ file })),
          facts: ['No other file in the project imports these files, and they import nothing from the project.'],
          steps: [
            'For each file, search the whole project (including config files, routes and HTML) for its name to check it is really unused.',
            'Give me a table of file, still needed (yes/no/unsure), and why.',
          ],
          mode: 'investigate',
        }),
        effort: 'S',
        impactFiles: orphans,
      }),
    ];
  },
};

export const unresolvedImportsRule: HealthRule = {
  kind: 'unresolved_imports',
  run(ctx) {
    const q = measureGraphQuality(ctx);
    if (q.danglingImports < 3 || q.unresolvedImportRatio <= ctx.thresholds.graph.unresolved_import_warn_ratio) return [];
    const top = q.unresolvedByFile.slice(0, 10);
    return [
      buildFinding(ctx, {
        kind: 'unresolved_imports',
        category: 'structure',
        target: 'unresolved-imports',
        severity: 'info',
        title: `${plural(q.danglingImports, 'import')} could not be connected to a file`,
        why:
          'FlowLens could not work out which file these imports point to. Some may be broken imports; others may use path ' +
          'shortcuts FlowLens does not understand yet. Either way, the map is missing these links.',
        evidence: top.map((u) => ({ file: u.file, line: u.lines[0], numbers: { unresolved: u.count } })),
        focus: makeFocus(ctx, { kind: 'file', identifier: top[0]?.file ?? '', files: top.map((u) => u.file) }),
        prompt: buildFixPrompt({
          goal: 'Check whether these imports point at files that exist.',
          files: top.map((u) => ({ file: u.file, lines: u.lines.slice(0, 5).join(', ') })),
          facts: [`${plural(q.danglingImports, 'import')} out of ${q.totalImports} could not be connected to a file.`],
          steps: [
            'For each listed line, check that the imported path exists (watch for wrong folders, renamed files, or missing files).',
            'Tell me which imports are really broken and how you would fix each one.',
          ],
          mode: 'investigate',
        }),
        effort: 'S',
        impactFiles: [],
      }),
    ];
  },
};
