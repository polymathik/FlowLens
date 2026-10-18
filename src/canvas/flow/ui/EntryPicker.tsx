/**
 * The entry-point picker: "what do you want to follow?" Entry points grouped by kind (HTTP routes, CLI
 * commands, pages, executables, event handlers) with counts and detection confidence, a filter box, tests
 * hidden unless asked for, and, always at the bottom, a search for any function (entry-point detection is
 * text-based and framework-gated, so some projects have none). Limited to a directory when opened from a
 * folder ("what can start in here?").
 */
import React, { useMemo, useState } from 'react';
import type { Entity } from '../../../contracts/entities.js';
import type { EntryPoint } from '../../../contracts/flow.js';
import { useCanvasStore } from '../../store/canvas-store';
import { searchEntities } from '../../utils/fuzzy-search';
import { useEntryPoints } from '../hooks/useEntryPoints';
import { button, linkButton } from '../../components/shared/ui';
import { EntryList, groupEntries } from './EntryList';

const TRACE_KINDS = new Set(['function', 'method', 'class']);

function SymbolSearch({ entities, onPick }: { entities: Entity[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => searchEntities(entities.filter((e) => TRACE_KINDS.has(e.kind)), q, 8), [entities, q]);
  return (
    <div style={{ padding: '8px 12px', borderTop: '1px solid var(--fl-border)' }}>
      <div style={{ fontWeight: 650, marginBottom: 4 }}>Or trace any function</div>
      <input type="search" data-testid="flow-symbol-search" placeholder="Search functions and methods…" value={q} onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', border: '1px solid var(--fl-border-strong)', borderRadius: 6, background: 'var(--fl-surface)', color: 'var(--fl-text)', fontSize: 12 }} />
      {hits.map((h) => (
        <button key={h.entity.id} type="button" className="fl-flow-entry" data-testid="flow-symbol-hit" onClick={() => onPick(h.entity.id)}>
          <b>{h.entity.name}</b>
          <small>{h.entity.file}:{h.entity.location?.line_start ?? ''}</small>
        </button>
      ))}
    </div>
  );
}

export interface EntryPickerProps {
  entities: Entity[];
  onPick: (entry: EntryPoint) => void;
  onPickId: (id: string) => void;
  onClose: () => void;
}

export function EntryPicker({ entities, onPick, onPickId, onClose }: EntryPickerProps) {
  const picker = useCanvasStore((s) => s.flowPicker);
  const setFlowPicker = useCanvasStore((s) => s.setFlowPicker);
  const flowTests = useCanvasStore((s) => s.flow?.includeTests);
  const [tests, setTests] = useState(!!flowTests);
  const [filter, setFilter] = useState('');
  const load = useEntryPoints(!!picker, { includeTests: tests, ...(picker?.path ? { path: picker.path } : {}) });
  const data = load.data;
  const groups = useMemo(() => (data ? groupEntries(data.entry_points, data.counts_by_kind, filter) : []), [data, filter]);
  if (!picker) return null;
  const total = data ? Object.entries(data.counts_by_kind).filter(([k]) => tests || k !== 'test').reduce((n, [, c]) => n + c, 0) : 0;

  return (
    <aside className="fl-flow-picker" data-testid="flow-picker" role="dialog" aria-label="Choose an entry point" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); } }}>
      <header>
        <h3>Trace a flow</h3>
        <button type="button" style={button} data-testid="flow-picker-close" onClick={onClose} aria-label="Close">Close</button>
      </header>
      <div style={{ padding: '0 12px 6px', color: 'var(--fl-muted)' }}>
        Pick what starts it: an HTTP route, a command, a page.
        {picker.path && (
          <> Only entry points under <b>{picker.path}</b>. <button type="button" style={linkButton} data-testid="flow-picker-all" onClick={() => setFlowPicker({})}>Show all</button></>
        )}
      </div>
      <div className="fl-flow-picker-tools">
        <input type="search" data-testid="flow-picker-filter" autoFocus placeholder={`Filter${data ? ` ${total} entry points` : ''}…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label title="Test files are hidden by default"><input type="checkbox" data-testid="flow-picker-tests" checked={tests} onChange={(e) => setTests(e.target.checked)} /> Tests</label>
      </div>
      <div className="fl-flow-picker-body" data-testid="flow-picker-body" aria-busy={load.loading}>
        {load.loading && !data && <div className="fl-flow-empty">Looking for entry points…</div>}
        {load.error && <div className="fl-flow-empty" data-testid="flow-picker-error">Could not load entry points: {load.error.message}</div>}
        {data && data.entry_points.length === 0 && (
          <div className="fl-flow-empty" data-testid="flow-picker-empty">
            <h4>No entry points found{picker.path ? ` under ${picker.path}` : ''}</h4>
            Entry points are found by reading the code of known frameworks (HTTP routers, command-line parsers, page routers, <code>package.json</code> bin and main).
            <ul>
              <li>An unknown framework or hand-written dispatch is not detected: that never produces a wrong label, just no entry.</li>
              <li>Files that only export helpers have no start of their own.</li>
            </ul>
            You can still trace any function below: search for it, or select it on the map and press <b>T</b>.
          </div>
        )}
        {data && data.entry_points.length > 0 && groups.length === 0 && <div className="fl-flow-empty" data-testid="flow-picker-nomatch">Nothing matches “{filter}”.</div>}
        {data && <EntryList groups={groups} filterActive={filter.trim().length > 0} onPick={onPick} />}
        {data?.truncated && <div className="fl-flow-empty">Showing the first {data.entry_points.length} of {data.total}. Filter to narrow it down.</div>}
      </div>
      <SymbolSearch entities={entities} onPick={onPickId} />
    </aside>
  );
}
