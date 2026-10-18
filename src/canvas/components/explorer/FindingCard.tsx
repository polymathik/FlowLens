/**
 * One ranked finding: what and where, why it matters, the evidence, and two
 * actions — jump to it on the map, or copy a ready-made prompt for an AI
 * coding assistant (with a select-and-copy fallback if the clipboard is blocked).
 */
import React, { useState } from 'react';
import type { HealthFinding } from '../../../contracts/health.js';
import { copyText } from './clipboard';
import { EFFORT_LABEL, SEVERITY_COLOR, SEVERITY_LABEL, evidenceText, reliedText } from './labels';

interface Props {
  finding: HealthFinding;
  onShowOnMap: () => void;
}

export function FindingCard({ finding: f, onShowOnMap }: Props) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle');

  const onCopy = async () => {
    setCopy((await copyText(f.fix_prompt)) ? 'copied' : 'manual');
    window.setTimeout(() => setCopy((c) => (c === 'copied' ? 'idle' : c)), 2500);
  };

  return (
    <li className="fl-finding" data-testid={`finding-${f.id}`} data-kind={f.kind} style={{ ['--sev' as string]: SEVERITY_COLOR[f.severity] }}>
      <div className="fl-finding-head">
        <span className="fl-sev">{SEVERITY_LABEL[f.severity]}</span>
        <span>Fix effort: {EFFORT_LABEL[f.effort]}</span>
        {f.blast_radius > 0 && <span>{reliedText(f.blast_radius)}</span>}
      </div>
      <h4>{f.title}</h4>
      <p>{f.why_it_matters}</p>
      {f.evidence.length > 0 && (
        <details>
          <summary>What FlowLens found ({f.evidence.length})</summary>
          <ul className="fl-evidence">
            {f.evidence.slice(0, 12).map((e, i) => {
              const t = evidenceText(e);
              return (
                <li key={i}>
                  <code>{t.where}</code> {t.detail}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      <div className="fl-actions">
        <button type="button" className="fl-primary-btn" onClick={onShowOnMap} data-testid="show-on-map">
          Show on map
        </button>
        <button type="button" className="fl-quiet-btn" onClick={onCopy} data-testid="copy-prompt">
          Copy fix prompt
        </button>
        {copy === 'copied' && (
          <span className="fl-copied" role="status">
            Copied. Paste it into your AI coding assistant.
          </span>
        )}
      </div>
      {copy === 'manual' && (
        <>
          <p style={{ marginTop: 8, fontSize: 12.5 }}>Your browser blocked copying. Select the text below and copy it yourself:</p>
          <textarea className="fl-prompt-fallback" readOnly value={f.fix_prompt} aria-label="Fix prompt" onFocus={(e) => e.currentTarget.select()} />
        </>
      )}
    </li>
  );
}
