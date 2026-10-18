/**
 * Header stack: toolbar row, then a row with the breadcrumb (left) and the
 * project stat strip (right). Static layout — nothing floats over the canvas.
 */
import React from 'react';
import type { Hierarchy } from '../../../contracts/hierarchy.js';
import type { FocusInfo } from '../../../contracts/canvas/index.js';
import { Toolbar } from './Toolbar';
import { BreadcrumbBar } from './BreadcrumbBar';
import { StatStrip } from './StatStrip';
import { COLORS } from '../shared/ui';

type ToolbarProps = React.ComponentProps<typeof Toolbar>;

export function CanvasHeader({ graphVersion, hierarchy, focusInfo, focusBar, ...toolbar }: ToolbarProps & { graphVersion: number; hierarchy: Hierarchy; focusInfo?: FocusInfo; focusBar?: React.ReactNode }) {
  return (
    <header style={{ flex: '0 0 auto', zIndex: 30 }}>
      <Toolbar {...toolbar} />
      {focusBar}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          padding: '5px 14px',
          background: COLORS.subtle,
          borderBottom: `1px solid ${COLORS.border}`,
          fontSize: 12,
        }}
      >
        <BreadcrumbBar hierarchy={hierarchy} focusInfo={focusInfo} />
        <StatStrip graphVersion={graphVersion} />
      </div>
    </header>
  );
}
