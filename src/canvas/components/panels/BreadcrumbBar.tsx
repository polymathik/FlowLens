/**
 * Breadcrumb for the open container: the full clickable path
 * (`Halcyon / packages / @halcyon/server / src / adapters / codex-adapter.ts /
 * CodexAdapter / parseSession`). A very long path folds its middle into a
 * "…" menu. Lives in the header row under the toolbar (not floating).
 */
import React, { useState } from 'react';
import type { Hierarchy } from '../../../contracts/hierarchy.js';
import { useCanvasStore } from '../../store/canvas-store';
import { crumbsFor, layoutCrumbs, type Crumb } from '../../utils/breadcrumb';
import { COLORS, floatingPanel, linkButton } from '../shared/ui';

function CrumbButton({ crumb, last, onOpen }: { crumb: Crumb; last: boolean; onOpen: (c: Crumb) => void }) {
  return (
    <button
      data-testid="crumb"
      data-node-id={crumb.id}
      title={crumb.title}
      onClick={() => onOpen(crumb)}
      disabled={last}
      style={{
        ...linkButton,
        color: last ? COLORS.text : COLORS.accent,
        fontWeight: last || crumb.level === -1 ? 600 : 400,
        cursor: last ? 'default' : 'pointer',
        maxWidth: 220,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {crumb.label}
    </button>
  );
}

export function BreadcrumbBar({ hierarchy }: { hierarchy: Hierarchy }) {
  const drillPath = useCanvasStore((s) => s.drillPath);
  const drillToLevel = useCanvasStore((s) => s.drillToLevel);
  const [menuOpen, setMenuOpen] = useState(false);
  const crumbs = crumbsFor(hierarchy, drillPath);
  const { head, hidden, tail } = layoutCrumbs(crumbs);
  const lastId = crumbs[crumbs.length - 1].id;
  const open = (c: Crumb) => {
    setMenuOpen(false);
    drillToLevel(c.level);
  };
  const sep = (key: string) => (
    <span key={key} aria-hidden style={{ color: COLORS.faint }}>
      /
    </span>
  );

  return (
    <nav aria-label="Location" data-testid="breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flexWrap: 'wrap', position: 'relative' }}>
      {head.map((c, i) => (
        <React.Fragment key={c.id}>
          {i > 0 && sep(`h${i}`)}
          <CrumbButton crumb={c} last={c.id === lastId} onOpen={open} />
        </React.Fragment>
      ))}
      {hidden.length > 0 && (
        <>
          {sep('m')}
          <button data-testid="crumb-menu" aria-haspopup="menu" aria-expanded={menuOpen} title={`${hidden.length} more levels`} style={linkButton} onClick={() => setMenuOpen((v) => !v)}>
            …
          </button>
          {menuOpen && (
            <div role="menu" data-testid="crumb-menu-list" style={{ ...floatingPanel, top: 24, left: 60, padding: 4, display: 'flex', flexDirection: 'column', minWidth: 180 }}>
              {hidden.map((c) => (
                <button key={c.id} role="menuitem" title={c.title} data-node-id={c.id} onClick={() => open(c)} style={{ ...linkButton, textAlign: 'left', padding: '4px 8px' }}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {tail.map((c) => (
        <React.Fragment key={c.id}>
          {sep(`t${c.id}`)}
          <CrumbButton crumb={c} last={c.id === lastId} onOpen={open} />
        </React.Fragment>
      ))}
      {drillPath.length === 0 && <span style={{ color: COLORS.faint, marginLeft: 6 }}>Double-click a box to open it</span>}
    </nav>
  );
}
