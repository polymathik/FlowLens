/**
 * Architecture rules editor: define layers by file pattern and which layers
 * each may / must not use. Every edit is validated and previewed live
 * (violation count + first breaks, and the "Rule breaks" overlay follows
 * the draft); Save writes `.flowlens/architecture.json` after server-side
 * validation.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { ArchitectureConfig } from '../../../../contracts/architecture.js';
import { ApiError, fetchArchitecture, saveArchitecture } from '../../../api/graph-client';
import {
  addLayer,
  normalizeConfig,
  removeLayer,
  renameLayer,
  setRestricted,
  toSavedConfig,
  toggleAccess,
  updateLayer,
} from '../../../utils/architecture-draft';
import { useCanvasStore } from '../../../store/canvas-store';
import { LayerCard } from './LayerCard';
import { useRulesPreview } from './useRulesPreview';
import { COLORS, button, buttonActive, floatingPanel, linkButton } from '../../shared/ui';

export function ArchitectureEditor({ onClose }: { onClose: () => void }) {
  const setOverlay = useCanvasStore((s) => s.setOverlay);
  const [draft, setDraft] = useState<ArchitectureConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const preview = useRulesPreview(draft, dirty);

  useEffect(() => {
    fetchArchitecture().then(
      (cfg) => setDraft(normalizeConfig(cfg)),
      (err) => setLoadError(String(err?.message ?? err)),
    );
  }, []);

  const edit = (fn: (c: ArchitectureConfig) => ArchitectureConfig) => {
    setDraft((d) => (d ? fn(d) : d));
    setDirty(true);
    setStatus(null);
  };

  const byLayer = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of preview.violations) m.set(v.layer_from, (m.get(v.layer_from) ?? 0) + 1);
    return m;
  }, [preview.violations]);

  const save = async () => {
    if (!draft) return;
    try {
      const res = await saveArchitecture(toSavedConfig(draft));
      setDirty(false);
      setStatus(`Saved · ${res.violation_count} rule breaks`);
    } catch (err) {
      setStatus(err instanceof ApiError && err.issues.length ? `Not saved: ${err.issues[0].message}` : `Not saved: ${String(err)}`);
    }
  };

  return (
    <div data-testid="rules-editor" style={{ ...floatingPanel, top: 12, right: 12, width: 380, maxHeight: 'calc(100% - 24px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>Architecture rules</span>
        <button style={button} onClick={() => edit(addLayer)} disabled={!draft}>
          + Layer
        </button>
        <button data-testid="rules-save" style={dirty ? buttonActive : button} onClick={save} disabled={!draft || preview.issues.length > 0}>
          Save
        </button>
        <button aria-label="Close" style={{ ...linkButton, color: COLORS.faint, fontSize: 16 }} onClick={onClose}>
          ×
        </button>
      </div>

      <div data-testid="rules-preview" style={{ padding: '8px 16px', fontSize: 11, background: preview.issues.length ? '#fff7ed' : preview.violations.length ? '#fef2f2' : '#f0fdf4', color: preview.issues.length ? '#9a3412' : preview.violations.length ? COLORS.danger : COLORS.ok }}>
        {loadError && `Could not load rules: ${loadError}`}
        {!loadError && preview.issues.length > 0 && preview.issues.map((i) => <div key={i.path + i.message}>{i.path ? `${i.path}: ` : ''}{i.message}</div>)}
        {!loadError && preview.issues.length === 0 && (
          <span>
            {preview.loading ? 'Checking… ' : ''}
            <strong data-testid="rules-violation-count">{preview.violations.length}</strong> rule breaks{dirty ? ' with these unsaved rules' : ''}
            {preview.violations.length > 0 && (
              <button style={{ ...linkButton, fontSize: 11 }} onClick={() => setOverlay('architecture-violations')}>
                show on map
              </button>
            )}
          </span>
        )}
        {status && <div style={{ color: COLORS.muted, marginTop: 2 }}>{status}</div>}
      </div>

      <div style={{ overflowY: 'auto' }}>
        {draft?.layers.length === 0 && (
          <div style={{ padding: 16, color: COLORS.muted }}>No layers yet. Add one, give it file patterns, then say which layers it may use.</div>
        )}
        {draft?.layers.map((layer, idx) => (
          <LayerCard
            key={idx}
            layer={layer}
            otherNames={draft.layers.filter((_, i) => i !== idx).map((l) => l.name)}
            violationCount={byLayer.get(layer.name) ?? 0}
            onRename={(name) => edit((c) => renameLayer(c, idx, name))}
            onPatterns={(patterns) => edit((c) => updateLayer(c, idx, { include: { ...c.layers[idx].include, patterns } }))}
            onToggle={(rule, target) => edit((c) => toggleAccess(c, idx, rule, target))}
            onRestrict={(on) => edit((c) => setRestricted(c, idx, on))}
            onDelete={() => edit((c) => removeLayer(c, idx))}
          />
        ))}
        {preview.violations.length > 0 && (
          <div style={{ padding: '10px 16px', fontSize: 11 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>First rule breaks</div>
            {preview.violations.slice(0, 5).map((v) => (
              <div key={v.id} style={{ color: COLORS.muted, padding: '2px 0' }}>
                {v.layer_from} → {v.layer_to} <span style={{ color: COLORS.faint }}>({v.rule === 'must_not_access' ? 'forbidden' : 'not allowed'}) {v.location.file}:{v.location.line}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
