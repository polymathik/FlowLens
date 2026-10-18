/**
 * "Step through": walks the hops in execution order. Prev / Play / Next and the caption of the current hop.
 * Playing advances one hop per 900 ms; for `prefers-reduced-motion` the marching animation of the active hop is off (CSS) and the camera jumps.
 */
import React, { useEffect } from 'react';
import { button } from '../../components/shared/ui';

export const STEP_INTERVAL_MS = 900;

export interface StepControlsProps {
  /** null = step-through is off. */
  step: number | null;
  total: number;
  playing: boolean;
  onStep: (step: number | null) => void;
  onPlaying: (playing: boolean) => void;
}

/** The caption of the current hop, floating at the top of the stage. */
export function StepCaption({ step, caption }: { step: number | null; caption: string }) {
  if (step === null) return null;
  return <div className="fl-flow-stepcap" data-testid="flow-step-caption" data-step={step} aria-live="polite" title={caption}>{caption}</div>;
}

export function StepControls({ step, total, playing, onStep, onPlaying }: StepControlsProps) {
  useEffect(() => {
    if (!playing || step === null) return;
    if (step >= total) {
      onPlaying(false);
      return;
    }
    const t = setTimeout(() => onStep(step + 1), STEP_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [playing, step, total, onStep, onPlaying]);

  if (step === null) {
    return (
      <button type="button" data-testid="flow-step-start" style={button} disabled={total === 0} title="Walk through the calls in the order they run" onClick={() => onStep(0)}>
        Step through
      </button>
    );
  }
  return (
    <span className="fl-flow-seg" role="group" aria-label="Step through" data-testid="flow-steps">
      <button type="button" className="fl-flow-ico" data-testid="flow-step-prev" aria-label="Previous step" disabled={step <= 0} onClick={() => { onPlaying(false); onStep(step - 1); }}>◀</button>
      <button type="button" className="fl-flow-ico" data-testid="flow-step-play" aria-pressed={playing} aria-label={playing ? 'Pause' : 'Play'} onClick={() => { if (!playing && step >= total) onStep(0); onPlaying(!playing); }}>{playing ? '❚❚' : '▶'}</button>
      <button type="button" className="fl-flow-ico" data-testid="flow-step-next" aria-label="Next step" disabled={step >= total} onClick={() => { onPlaying(false); onStep(step + 1); }}>▶|</button>
      <button type="button" data-testid="flow-step-stop" title="Stop stepping" onClick={() => { onPlaying(false); onStep(null); }}>Done</button>
    </span>
  );
}
