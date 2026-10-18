/** A swimlane band: the Map's zone frame (same colours), a header chip with the lane name and directory in the left gutter. */
import React from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { FlowLaneData } from '../../../contracts/canvas/index.js';

export const FlowLaneNode = React.memo(({ data }: NodeProps<Node<FlowLaneData, 'flowLane'>>) => {
  const { lane } = data;
  return (
    <div className="fl-flow-lane" data-testid="flow-lane" data-lane-id={lane.id} data-lane-kind={lane.kind} data-hue={lane.colorIndex}>
      <div className="fl-flow-lane-head">
        <span className="fl-flow-lane-chip" title={`${lane.kind}: ${lane.path || 'project root'}`}>
          <span className="fl-flow-swatch" aria-hidden />
          <span>{lane.label}</span>
        </span>
        {lane.path && lane.path !== lane.label && <span className="fl-flow-lane-sub">{lane.path}</span>}
      </div>
    </div>
  );
});
FlowLaneNode.displayName = 'FlowLaneNode';
