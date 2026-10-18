/**
 * Shared helpers for building findings: the rule interface, stable ids,
 * canvas focus targets, severity bands and the fix-prompt template.
 */
import { buildCanvasUrl, type CanvasLinkKind, type CanvasOverlay } from '../contracts/canvas-links.js';
import type {
  HealthCategory,
  HealthEffort,
  HealthEvidence,
  HealthFinding,
  HealthFindingKind,
  HealthFocus,
  HealthSeverity,
} from '../contracts/health.js';
import { hashContent } from '../utils/hash.js';
import { SEVERITY_POINTS } from './config.js';
import type { HealthContext } from './context.js';
import { clampTitle } from './glossary.js';

/** A finding before ranking assigns `rank` / `rank_score`. */
export type RawFinding = Omit<HealthFinding, 'rank' | 'rank_score'>;

export interface HealthRule {
  kind: HealthFindingKind;
  run(ctx: HealthContext): Promise<RawFinding[]> | RawFinding[];
}

export function findingId(kind: HealthFindingKind, target: string): string {
  return hashContent(`health:${kind}:${target}`).slice(0, 16);
}

export function makeFocus(
  ctx: HealthContext,
  target: { kind: CanvasLinkKind; identifier: string; overlay?: CanvasOverlay; entity_ids?: string[]; files: string[] },
): HealthFocus {
  return {
    kind: target.kind,
    identifier: target.identifier,
    overlay: target.overlay,
    entity_ids: target.entity_ids ?? [],
    files: target.files,
    project_id: ctx.input.project.id,
    url: buildCanvasUrl({
      kind: target.kind,
      identifier: target.identifier,
      overlay: target.overlay,
      baseUrl: ctx.canvasBaseUrl,
      projectId: ctx.input.project.id ?? undefined,
    }),
  };
}

/** Severity from a measured value against warn/high/critical bars. */
export function bandSeverity(value: number, warn: number, high: number, critical: number): HealthSeverity {
  if (value > critical) return 'critical';
  if (value > high) return 'high';
  if (value > warn) return 'medium';
  return 'low';
}

export interface FindingParts {
  kind: HealthFindingKind;
  category: HealthCategory;
  target: string;
  severity: HealthSeverity;
  title: string;
  why: string;
  evidence: HealthEvidence[];
  focus: HealthFocus;
  prompt: string;
  effort: HealthEffort;
  /** Files whose blast radius drives the impact multiplier. */
  impactFiles: string[];
  /** Override base points (default: SEVERITY_POINTS[severity]). */
  points?: number;
  /** Override the whole penalty (rules whose penalty is a per-file sum). */
  penalty?: number;
}

/** Assemble a RawFinding; penalty = points × max impact of the files involved. */
export function buildFinding(ctx: HealthContext, p: FindingParts): RawFinding {
  const impact = Math.max(1, ...p.impactFiles.map((f) => ctx.impact(f)));
  const blast = Math.max(0, ...p.impactFiles.map((f) => ctx.blast(f)));
  const points = p.points ?? SEVERITY_POINTS[p.severity];
  return {
    id: findingId(p.kind, p.target),
    kind: p.kind,
    category: p.category,
    severity: p.severity,
    title: clampTitle(p.title),
    why_it_matters: p.why,
    evidence: p.evidence,
    focus: p.focus,
    fix_prompt: p.prompt,
    effort: p.effort,
    penalty: round2(p.penalty ?? points * impact),
    blast_radius: blast,
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PromptSpec {
  goal: string;
  files: Array<{ file: string; lines?: string; note?: string }>;
  facts: string[];
  steps: string[];
  /** 'investigate' = ask for a written answer only, no edits. */
  mode?: 'edit' | 'investigate';
}

/**
 * Ready-to-paste prompt for Claude Code / Cursor / Lovable / Bolt. Names the
 * exact files, states one goal, and asks for a small behaviour-preserving
 * change with a plan first and a check afterwards.
 */
export function buildFixPrompt(spec: PromptSpec): string {
  const files = spec.files
    .map((f) => `- ${f.file}${f.lines ? ` (${/[–,]/.test(f.lines) ? 'lines' : 'line'} ${f.lines})` : ''}${f.note ? ` — ${f.note}` : ''}`)
    .join('\n');
  const facts = spec.facts.map((f) => `- ${f}`).join('\n');
  const steps = spec.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const n = spec.steps.length;
  const closing =
    spec.mode === 'investigate'
      ? [`${n + 1}. Do not edit or delete any files yet; just report back so I can decide.`]
      : [
          `${n + 1}. Keep the app's behaviour exactly the same: do not change what any function returns, and do not rename or remove anything other files import unless you update every caller.`,
          `${n + 2}. Make the smallest safe change. First tell me your plan in 3 short bullets, then make the edit.`,
          `${n + 3}. Afterwards run the project's type-check and tests (if it has them) and tell me exactly what you ran and the result.`,
        ];
  return [
    `Goal: ${spec.goal}`,
    '',
    'Files involved:',
    files,
    '',
    'What a code-health check (FlowLens) found:',
    facts,
    '',
    'Please:',
    steps,
    ...closing,
  ].join('\n');
}

export function lineRange(start: number, end: number): string {
  return start === end ? `${start}` : `${start}–${end}`;
}
