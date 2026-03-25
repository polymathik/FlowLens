import { describe, it, expect } from 'vitest';
import { computeQualityScore } from '../../../src/metrics/quality-score.js';
import type { EntityMetrics } from '../../../src/contracts/entities.js';

describe('computeQualityScore', () => {
  it('returns 100 for low complexity and few lines', () => {
    const metrics: EntityMetrics = { line_count: 20, cognitive_complexity: 3 };
    expect(computeQualityScore(metrics)).toBe(100);
  });

  it('drops by 40 when cognitive complexity > 25', () => {
    const metrics: EntityMetrics = { line_count: 20, cognitive_complexity: 30 };
    expect(computeQualityScore(metrics)).toBe(60);
  });

  it('drops by 25 when cognitive complexity > 15', () => {
    const metrics: EntityMetrics = { line_count: 20, cognitive_complexity: 20 };
    expect(computeQualityScore(metrics)).toBe(75);
  });

  it('drops by 15 when cognitive complexity > 10', () => {
    const metrics: EntityMetrics = { line_count: 20, cognitive_complexity: 12 };
    expect(computeQualityScore(metrics)).toBe(85);
  });

  it('drops by 5 when cognitive complexity > 5', () => {
    const metrics: EntityMetrics = { line_count: 20, cognitive_complexity: 7 };
    expect(computeQualityScore(metrics)).toBe(95);
  });

  it('drops by 20 when line count > 200', () => {
    const metrics: EntityMetrics = { line_count: 250, cognitive_complexity: 3 };
    expect(computeQualityScore(metrics)).toBe(80);
  });

  it('drops by 10 when line count > 100', () => {
    const metrics: EntityMetrics = { line_count: 150, cognitive_complexity: 3 };
    expect(computeQualityScore(metrics)).toBe(90);
  });

  it('drops by 5 when line count > 50', () => {
    const metrics: EntityMetrics = { line_count: 75, cognitive_complexity: 3 };
    expect(computeQualityScore(metrics)).toBe(95);
  });

  it('combines complexity and line count penalties', () => {
    // complexity 30 (-40) + lines 250 (-20) = 40
    const metrics: EntityMetrics = { line_count: 250, cognitive_complexity: 30 };
    expect(computeQualityScore(metrics)).toBe(40);
  });

  it('applies efferent coupling penalty when > 15', () => {
    const metrics: EntityMetrics = { line_count: 20, cognitive_complexity: 3, efferent_coupling: 20 };
    expect(computeQualityScore(metrics)).toBe(85);
  });

  it('applies afferent coupling penalty when > 20', () => {
    const metrics: EntityMetrics = { line_count: 20, cognitive_complexity: 3, afferent_coupling: 25 };
    expect(computeQualityScore(metrics)).toBe(90);
  });

  it('floors at 0 with all penalties combined', () => {
    // complexity 30 (-40) + lines 300 (-20) + efferent 20 (-15) + afferent 25 (-10) = 100 - 85 = 15
    const metrics: EntityMetrics = {
      line_count: 300,
      cognitive_complexity: 30,
      efferent_coupling: 20,
      afferent_coupling: 25,
    };
    expect(computeQualityScore(metrics)).toBe(15);
  });

  it('returns 100 for very short function with no complexity', () => {
    const metrics: EntityMetrics = { line_count: 5 };
    expect(computeQualityScore(metrics)).toBe(100);
  });

  it('returns 100 when complexity is absent', () => {
    const metrics: EntityMetrics = { line_count: 20 };
    expect(computeQualityScore(metrics)).toBe(100);
  });

  it('does not penalise efferent coupling at or below 15', () => {
    const metrics: EntityMetrics = { line_count: 20, cognitive_complexity: 3, efferent_coupling: 15 };
    expect(computeQualityScore(metrics)).toBe(100);
  });

  it('does not penalise afferent coupling at or below 20', () => {
    const metrics: EntityMetrics = { line_count: 20, cognitive_complexity: 3, afferent_coupling: 20 };
    expect(computeQualityScore(metrics)).toBe(100);
  });
});
