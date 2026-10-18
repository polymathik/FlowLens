/**
 * Breadcrumb for the open container: the full clickable path
 * (`Halcyon / packages / @halcyon/server / src / adapters / codex-adapter.ts /
 * CodexAdapter / parseSession`). A very long path folds its middle into a
 * "…" menu. Lives in the header row under the toolbar (not floating).
 */
import React, { useState } from 'react';
import type { Hierarchy } from '../../../contracts/hierarchy.js';
import type { FocusInfo } from '../../../contracts/canvas/index.js';
import { pathTo } from '../../../analysis/hierarchy/index.js';
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

/**
 * Focus mode: `Project / folder / … / Focus: parseSession`. The crumbs are the focused item's ancestors
 * (each one leaves Focus mode and opens that container); the last crumb is the focus itself.
 */
export function BreadcrumbBar({ hierarchy, focusInfo }: { hierarchy: Hierarchy; focusInfo?: FocusInfo }) {
  const drillPath = useCanvasStore((s) => s.drillPath);
  const drillToLevel = useCanvasStore((s) => s.drillToLevel);
  const setDrillPath = useCanvasStore((s) => s.setDrillPath);
  const focus = useCanvasStore((s) => s.focus);
  const setFocus = useCanvasStore((s) => s.setFocus);
  const [menuOpen, setMenuOpen] = useState(false);
  const focused = focus !== null;
  const above = focusInfo && hierarchy.nodes.has(focusInfo.focusId) ? pathTo(hierarchy, focusInfo.focusId).slice(0, -1) : [];
  const crumbs = crumbsFor(hierarchy, focused ? above : drillPath);
  const { head, hidden, tail } = layoutCrumbs(crumbs);
  const lastId = focused ? '' : crumbs[crumbs.length - 1].id;
  const open = (c: Crumb) => {
    setMenuOpen(false);
    if (!focused) return drillToLevel(c.level);
    setFocus(null);
    setDrillPath(pathTo(hierarchy, c.id));
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
      {focused && (
        <>
          {sep('f')}
          <span data-testid="crumb-focus" aria-current="page" title={`Focus mode: ${focusInfo?.label ?? focus?.id}`} style={{ fontWeight: 600, color: COLORS.text, padding: '2px 4px', whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Focus: {focusInfo?.label ?? focus?.id}
          </span>
        </>
      )}
      {!focused && drillPath.length === 0 && <span style={{ color: COLORS.faint, marginLeft: 6 }}>Double-click a box to open it</span>}
    </nav>
  );
}
