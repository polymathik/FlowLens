/**
 * The scrubber stage: commit-density sparkline, date axis, the per-zone
 * stacked area chart, the playhead and the compare marker, all on one
 * horizontal axis. One focusable `role="slider"` covers it: drag or click to
 * move the playhead, Shift-click to pin commit A of a comparison. Keys are
 * handled by the bar (see useTimelineKeys), so they work wherever the focus is.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { HistorySummary } from '../../contracts/history.js';
import { stackPaths, type ChartSeries } from './chart-model';
import { axisPositions, dateTicks, density, fractionOf, indexAtFraction, formatDate, type AxisMode } from './scrub-math';

const PAD = 10;
const SPARK_H = 16;
const AXIS_Y = SPARK_H + 4;
const CHART_TOP = 46;
const STAGE_H = 118;

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

interface StageProps {
  history: HistorySummary;
  axis: AxisMode;
  index: number;
  compareFrom: number | null;
  series: ChartSeries[];
  chartOpen: boolean;
  metric: 'files' | 'loc';
  onSeek: (index: number) => void;
  onScrubStart: () => void;
  onPin: (index: number) => void;
  valueText: string;
}

export function Stage({ history, axis, index, compareFrom, series, chartOpen, metric, onSeek, onScrubStart, onPin, valueText }: StageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const plotW = Math.max(0, width - PAD * 2);
  const n = history.commits.length;
  const positions = useMemo(() => axisPositions(history.commits, axis), [history.commits, axis]);
  const ticks = useMemo(() => {
    let lastX = -Infinity;
    return dateTicks(history.commits, positions, Math.max(2, Math.floor(plotW / 50))).filter((t) => {
      const x = t.frac * plotW;
      if (x - lastX < 46) return false; // labels never overlap
      lastX = x;
      return true;
    });
  }, [history.commits, positions, plotW]);
  const bars = useMemo(() => density(positions, Math.max(8, Math.floor(plotW / 4))), [positions, plotW]);
  const barMax = Math.max(1, ...bars);
  const chartH = chartOpen ? STAGE_H - CHART_TOP - 2 : 0;
  const stack = useMemo(() => (chartOpen && plotW > 0 ? stackPaths(series, positions, plotW, chartH, Math.max(2, Math.floor(plotW / 2))) : { paths: [], yMax: 0 }), [chartOpen, series, positions, plotW, chartH]);
  const dragging = useRef(false);
  const xOf = (i: number): number => PAD + (positions[i] ?? 0) * plotW;

  const at = (e: React.PointerEvent): number => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return indexAtFraction(positions, fractionOf(e.clientX, box.left + PAD, plotW));
  };
  return (
    <div ref={ref} className="fl-tl-stage" style={{ ['--fl-tl-stage-h' as string]: `${chartOpen ? STAGE_H : 42}px` }} data-testid="tl-stage">
      <svg aria-hidden>
        <g transform={`translate(${PAD},0)`}>
          {bars.map((b, i) =>
            b > 0 ? <rect key={i} x={(i * plotW) / bars.length} y={SPARK_H - (b / barMax) * SPARK_H} width={Math.max(1, plotW / bars.length - 1)} height={(b / barMax) * SPARK_H} rx={1} fill="var(--fl-accent)" opacity={0.45} /> : null,
          )}
        </g>
        <g className="fl-tl-axis" transform={`translate(${PAD},0)`}>
          <line x1={0} x2={plotW} y1={AXIS_Y} y2={AXIS_Y} />
          {ticks.map((t, i) => (
            <g key={i} transform={`translate(${t.frac * plotW},0)`}>
              <line y1={AXIS_Y} y2={AXIS_Y + 5} />
              <text x={3} y={AXIS_Y + 16}>{t.label}</text>
            </g>
          ))}
        </g>
        {chartOpen && stack.paths.length > 0 && (
          <g transform={`translate(${PAD},${CHART_TOP})`}>
            {stack.paths.map((p) => (
              <path key={p.key ?? 'other'} d={p.d} fill={p.key === null ? 'var(--fl-faint)' : `rgb(var(--fl-zone-${p.hue}))`} fillOpacity={p.key === null ? 0.45 : 0.78} stroke="var(--fl-surface)" strokeWidth={1} data-series={p.label} />
            ))}
            <text x={2} y={11} fill="var(--fl-faint)" fontSize={10} fontFamily="var(--fl-font)">
              {stack.yMax.toLocaleString('en-US')} {metric === 'files' ? 'files' : 'lines'}
            </text>
            <line x1={0} x2={plotW} y1={chartH} y2={chartH} stroke="var(--fl-border-strong)" />
          </g>
        )}
      </svg>
      {compareFrom !== null && compareFrom < n && (
        <div className="fl-tl-marker" data-testid="tl-marker-a" style={{ left: xOf(compareFrom) }} title={`Commit A: ${history.commits[compareFrom].sha.slice(0, 7)}, ${formatDate(history.commits[compareFrom].date)}`}>
          <span>A</span>
        </div>
      )}
      <div className="fl-tl-playhead" data-testid="tl-playhead" style={{ left: xOf(index) }} />
      <div
        role="slider"
        tabIndex={0}
        className="fl-tl-slider"
        data-testid="tl-slider"
        aria-label="History position, commit by commit"
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={index + 1}
        aria-valuetext={valueText}
        aria-orientation="horizontal"
        title="Drag to move through history. Shift-click pins commit A for a comparison."
        onPointerDown={(e) => {
          e.currentTarget.focus();
          if (e.shiftKey) return onPin(at(e));
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onScrubStart();
          onSeek(at(e));
        }}
        onPointerMove={(e) => dragging.current && onSeek(at(e))}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
        onPointerCancel={() => void (dragging.current = false)}
      />
    </div>
  );
}
