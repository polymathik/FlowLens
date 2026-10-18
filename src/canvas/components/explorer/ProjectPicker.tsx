/**
 * "+" picker: every registered project with its status and last index
 * time. Choosing one opens (or focuses) its tab on the Health screen.
 * Escape closes; arrow keys move between items.
 */
import React, { useEffect, useRef } from 'react';
import { formatRelativeTime } from '../../utils/format';
import { useExplorerStore } from '../../store/explorer-store';
import { navigate } from '../../router/navigate';
import { tabHash } from '../../router/explorer-route';
import { useProjects } from './useProjects';

export function ProjectPicker({ onClose }: { onClose: () => void }) {
  const { projects, refresh } = useProjects();
  const openTabs = useExplorerStore((s) => s.openTabs);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refresh();
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.fl-picker-item') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else return;
    e.preventDefault();
  };

  return (
    <div ref={ref} className="fl-picker" role="dialog" aria-label="Open a project" onKeyDown={onKey} data-testid="project-picker">
      <div className="fl-picker-title">Projects FlowLens knows about</div>
      {projects && projects.length === 0 && (
        <div className="fl-picker-empty">
          None yet. Run <code>flowlens init</code> inside a project folder to add it.
        </div>
      )}
      {(projects ?? []).map((p) => (
        <button
          key={p.id}
          type="button"
          className="fl-picker-item"
          data-testid={`pick-${p.id}`}
          onClick={() => {
            onClose();
            navigate(tabHash(p.id));
          }}
        >
          <span style={{ fontWeight: 600 }}>{p.name}</span>
          <span>
            {p.status === 'missing' ? (
              <span className="fl-badge fl-badge-danger">Missing</span>
            ) : openTabs.includes(p.id) ? (
              <span className="fl-badge">Open</span>
            ) : null}
          </span>
          <small>
            {p.status === 'missing' ? p.root : `Indexed ${formatRelativeTime(p.last_indexed)} — ${p.root}`}
          </small>
        </button>
      ))}
    </div>
  );
}
