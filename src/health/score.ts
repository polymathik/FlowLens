/**
 * Scoring model (see _docs/specs/PHASE-11-HEALTH.md §3).
 *
 *   size_factor     = max(1, sqrt(files / 20))
 *   category score  = round(100 × exp(−Σ penalty / (30 × size_factor)))
 *   overall score   = round(Σ weight × category score)   (unknown categories
 *                     are dropped and the remaining weights renormalised)
 *   grade           = A ≥ 90 > B ≥ 80 > C ≥ 70 > D ≥ 60 > F
 *
 * Monotonic: every penalty is a non-decreasing function of the graph's
 * edges and metrics, and exp/round are non-increasing in the penalty, so
 * adding a problem can never raise any score.
 */
import type {
  HealthBreakdown,
  HealthCategory,
  HealthFinding,
  HealthGrade,
  HealthSubScore,
} from '../contracts/health.js';
import { CATEGORY_LABELS, CATEGORY_WEIGHTS, GRADE_BANDS, SCORING } from './config.js';
import { plural } from './glossary.js';
import { round2 } from './finding.js';

export interface ScoreResult {
  score: number;
  grade: HealthGrade;
  breakdown: HealthBreakdown;
}

const ORDER: HealthCategory[] = ['tangles', 'structure', 'complexity', 'change_risk', 'size', 'coupling'];

export function sizeFactor(fileCount: number): number {
  return Math.max(1, Math.sqrt(fileCount / SCORING.size_files));
}

export function categoryScore(penalty: number, sf: number): number {
  return Math.round(100 * Math.exp(-penalty / (SCORING.k * sf)));
}

export function gradeFor(score: number): HealthGrade {
  return GRADE_BANDS.find((b) => score >= b.min)!.grade;
}

export function computeScore(
  findings: HealthFinding[],
  opts: { fileCount: number; unknown: HealthCategory[] },
): ScoreResult {
  const sf = sizeFactor(opts.fileCount);
  const known = ORDER.filter((c) => !opts.unknown.includes(c));
  const weightSum = known.reduce((s, c) => s + CATEGORY_WEIGHTS[c], 0);

  const sub_scores: HealthSubScore[] = ORDER.map((category) => {
    const mine = findings.filter((f) => f.category === category && f.penalty > 0);
    const penalty = round2(mine.reduce((s, f) => s + f.penalty, 0));
    const isKnown = known.includes(category);
    const lowered_by = [...mine]
      .sort((a, b) => b.penalty - a.penalty || a.id.localeCompare(b.id))
      .slice(0, 5)
      .map((f) => ({ finding_id: f.id, title: f.title, points: f.penalty }));
    return {
      category,
      label: CATEGORY_LABELS[category],
      score: isKnown ? categoryScore(penalty, sf) : null,
      weight: isKnown ? round2(CATEGORY_WEIGHTS[category] / weightSum) : 0,
      penalty,
      lowered_by,
      explanation: explain(isKnown, mine.length, lowered_by[0]?.title),
    };
  });

  const score = Math.round(
    sub_scores.reduce((s, c) => s + (c.score === null ? 0 : (CATEGORY_WEIGHTS[c.category] / weightSum) * c.score), 0),
  );
  return {
    score,
    grade: gradeFor(score),
    breakdown: {
      size_factor: round2(sf),
      sub_scores,
      formula:
        'Each area starts at 100 and loses points for every problem found (bigger and more relied-on problems cost more; ' +
        'larger projects get a little more slack). The overall score is the weighted average of the areas that could be measured.',
    },
  };
}

function explain(known: boolean, count: number, topTitle?: string): string {
  if (!known) return 'Not measured (needs git history).';
  if (count === 0) return 'Nothing found here.';
  return `Lowered by ${plural(count, 'problem')}; biggest: ${topTitle}.`;
}
