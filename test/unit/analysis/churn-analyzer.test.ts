import { describe, it, expect } from 'vitest';
import { computeChurn } from '../../../src/analysis/churn-analyzer.js';
import { join } from 'node:path';

// Test against the FlowLens repo itself (it IS a git repo)
const ROOT = join(import.meta.dirname, '../../..');

describe('ChurnAnalyzer', () => {
  it('returns churn data for files in a git repo', async () => {
    const churn = await computeChurn(ROOT, { period_days: 365 });
    expect(churn.size).toBeGreaterThan(0);
    // package.json should have been changed
    const pkg = churn.get('package.json');
    if (pkg) {
      expect(pkg.change_count).toBeGreaterThan(0);
      expect(pkg.churn_rate).toBeGreaterThan(0);
      expect(pkg.period_days).toBe(365);
    }
  });

  it('returns empty map for non-git directory', async () => {
    const churn = await computeChurn('/tmp');
    expect(churn.size).toBe(0);
  });

  it('respects period_days', async () => {
    const churn = await computeChurn(ROOT, { period_days: 1 });
    // With 1 day period, likely fewer files changed
    expect(churn.size).toBeLessThanOrEqual(
      (await computeChurn(ROOT, { period_days: 365 })).size
    );
  });

  it('churn_rate is change_count / period_days', async () => {
    const churn = await computeChurn(ROOT, { period_days: 90 });
    for (const [, data] of churn) {
      expect(data.churn_rate).toBeCloseTo(data.change_count / 90, 5);
      break; // Check just one
    }
  });
});
