/**
 * Header stack: toolbar row, then a row with the breadcrumb (left) and the
 * project stat strip (right). Static layout — nothing floats over the canvas.
 */
import React from 'react';
import { Toolbar } from './Toolbar';
import { BreadcrumbBar } from './BreadcrumbBar';
import { StatStrip } from './StatStrip';
import { COLORS } from '../shared/ui';

type ToolbarProps = React.ComponentProps<typeof Toolbar>;

export function CanvasHeader({ graphVersion, ...toolbar }: ToolbarProps & { graphVersion: number }) {
  return (
    <header style={{ flex: '0 0 auto', zIndex: 30 }}>
      <Toolbar {...toolbar} />
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
        <BreadcrumbBar />
        <StatStrip graphVersion={graphVersion} />
      </div>
    </header>
  );
}
