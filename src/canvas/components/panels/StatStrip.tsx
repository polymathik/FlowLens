/**
 * Minimal project stats from GET /summary (files, symbols, relations,
 * cycles, rule breaks, last indexed). The full Health/Home screens arrive in
 * wave 2; this strip only surfaces the numbers.
 */
import React, { useEffect, useState } from 'react';
import type { CanvasSummary } from '../../../contracts/canvas/index.js';
import { useGraphClient } from '../explorer/project-context';
import { COLORS } from '../shared/ui';
import { formatRelativeTime } from '../../utils/format';

function Stat({ label, value, tone, testId }: { label: string; value: React.ReactNode; tone?: 'warn'; testId: string }) {
  return (
    <span data-testid={testId} style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
      <strong style={{ color: tone === 'warn' ? COLORS.danger : COLORS.text, fontWeight: 650 }}>{value}</strong>
      <span style={{ color: COLORS.muted }}>{label}</span>
    </span>
  );
}

export function StatStrip({ graphVersion }: { graphVersion: number }) {
  const { fetchSummary } = useGraphClient();
  const [summary, setSummary] = useState<CanvasSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSummary().then(
      (s) => !cancelled && setSummary(s),
      () => !cancelled && setSummary(null),
    );
    return () => {
      cancelled = true;
    };
  }, [graphVersion, fetchSummary]);

  if (!summary) return null;
  const n = (v: number) => v.toLocaleString();
  return (
    <div data-testid="stat-strip" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
      <Stat testId="stat-files" label="files" value={n(summary.file_count)} />
      <Stat testId="stat-symbols" label="symbols" value={n(summary.entity_count)} />
      <Stat testId="stat-relations" label="relations" value={n(summary.relation_count)} />
      <Stat testId="stat-cycles" label="cycles" value={n(summary.cycle_count)} tone={summary.cycle_count ? 'warn' : undefined} />
      <Stat testId="stat-violations" label="rule breaks" value={n(summary.violation_count)} tone={summary.violation_count ? 'warn' : undefined} />
      <span data-testid="stat-indexed" style={{ color: COLORS.faint }} title={summary.last_indexed ?? ''}>
        indexed {formatRelativeTime(summary.last_indexed)}
      </span>
    </div>
  );
}
