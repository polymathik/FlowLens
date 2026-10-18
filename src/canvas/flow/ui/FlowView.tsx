/**
 * The React Flow surface of the flow: lane bands, cards and labelled hops, with the Map's fit mechanism
 * (commit the nodes, wait two animation frames so React Flow has adopted them, then fit; keyed on the
 * model identity so a re-render, a selection or a step never moves the camera). Own provider, nested in
 * the Map's, so the Map's viewport is untouched while the flow is open and restored when it closes.
 */
import React, { useEffect, useRef } from 'react';
import { Background, BackgroundVariant, Controls, MiniMap, PanOnScrollMode, ReactFlow, ReactFlowProvider, useKeyPress, useReactFlow, useStore, type Edge, type Node } from '@xyflow/react';
import { FIT_VIEW_MAX_ZOOM } from '../../../contracts/canvas/index.js';
import { useColorMode } from '../../components/explorer/theme';
import { FIT_PADDING } from '../../hooks/useCanvasLayout';
import { flowEdgeTypes, flowNodeTypes } from './flow-types';

export interface FlowViewProps {
  nodes: Node[];
  edges: Edge[];
  /** Changes when the picture's structure does (the model key): the camera fits again. */
  fitKey: string;
  /** Card to bring into view (step-through), if it is outside. */
  reveal: string | null;
  reducedMotion: boolean;
  onNodeClick: (e: React.MouseEvent, node: Node) => void;
  onNodeDoubleClick: (e: React.MouseEvent, node: Node) => void;
  onPaneClick: () => void;
}

const minimapColor = (n: Node) => (n.type === 'flowLane' ? 'rgb(var(--fl-zone-5) / 0.25)' : 'var(--fl-minimap-entity)');

/** Fit after commit, and bring the revealed card into view when it is off screen. */
function Camera({ fitKey, reveal, reducedMotion }: Pick<FlowViewProps, 'fitKey' | 'reveal' | 'reducedMotion'>) {
  const rf = useReactFlow();
  const size = useStore((s) => `${s.width}x${s.height}`);
  const fitted = useRef('');

  useEffect(() => {
    const id = `${fitKey}|${size}`;
    if (fitted.current === id) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        fitted.current = id;
        rf.fitView({ padding: FIT_PADDING, maxZoom: FIT_VIEW_MAX_ZOOM, duration: reducedMotion ? 0 : 200 });
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [fitKey, size, rf, reducedMotion]);

  useEffect(() => {
    if (!reveal) return;
    const n = rf.getInternalNode(reveal);
    if (!n) return;
    const { x, y } = n.internals.positionAbsolute;
    const w = n.measured.width ?? Number(n.width ?? 236);
    const h = n.measured.height ?? Number(n.height ?? 56);
    const v = rf.getViewport();
    const el = document.querySelector('[data-testid="flow-canvas"] .react-flow');
    const vw = el?.clientWidth ?? 0;
    const vh = el?.clientHeight ?? 0;
    const left = x * v.zoom + v.x;
    const top = y * v.zoom + v.y;
    const inside = left >= 0 && top >= 0 && left + w * v.zoom <= vw && top + h * v.zoom <= vh;
    if (!inside && vw > 0) void rf.setCenter(x + w / 2, y + h / 2, { zoom: Math.max(v.zoom, 0.6), duration: reducedMotion ? 0 : 250 });
  }, [reveal, rf, reducedMotion]);
  return null;
}

function Surface(props: FlowViewProps) {
  const colorMode = useColorMode();
  const shiftHeld = useKeyPress('Shift');
  return (
    <ReactFlow
      nodes={props.nodes}
      edges={props.edges}
      nodeTypes={flowNodeTypes}
      edgeTypes={flowEdgeTypes}
      onNodeClick={props.onNodeClick}
      onNodeDoubleClick={props.onNodeDoubleClick}
      onPaneClick={props.onPaneClick}
      minZoom={0.02}
      maxZoom={4}
      zoomOnDoubleClick={false}
      panOnScroll={shiftHeld}
      panOnScrollMode={PanOnScrollMode.Free}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
      colorMode={colorMode}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
      <Controls showInteractive={false} />
      <MiniMap nodeColor={minimapColor} nodeStrokeWidth={2} zoomable pannable style={{ width: 150, height: 100 }} />
      <Camera fitKey={props.fitKey} reveal={props.reveal} reducedMotion={props.reducedMotion} />
    </ReactFlow>
  );
}

export function FlowView(props: FlowViewProps) {
  return (
    <ReactFlowProvider>
      <Surface {...props} />
    </ReactFlowProvider>
  );
}
