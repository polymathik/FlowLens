/**
 * Main React Flow canvas component.
 *
 * Wraps the graph in a ReactFlowProvider and renders Background, Controls,
 * and MiniMap alongside the nodes/edges loaded from the graph API.
 * Uses custom node types (System, File, Entity) and ELK.js auto-layout.
 *
 * Integrations:
 * - Zustand store for state management
 * - Semantic zoom (viewport zoom -> discrete zoom level)
 * - Breadcrumb drill-down navigation
 * - Overlay system (complexity, churn, cycles, violations)
 * - Custom edge types (relation, violation, cycle)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphData } from '../hooks/useGraphData';
import { useLayout } from '../hooks/useLayout';
import { useSemanticZoom } from '../hooks/useSemanticZoom';
import { useCanvasStore } from '../store/canvas-store';
import { SystemNode } from './nodes/SystemNode';
import { FileNode } from './nodes/FileNode';
import { EntityNode } from './nodes/EntityNode';
import { RelationEdge } from './edges/RelationEdge';
import { ViolationEdge } from './edges/ViolationEdge';
import { CycleEdge } from './edges/CycleEdge';
import { BreadcrumbBar } from './panels/BreadcrumbBar';
import { OverlayLegend } from './overlays/OverlayLegend';
import { applyOverlay, type OverlayExtraData } from './overlays/OverlayManager';
import { fetchCycles, fetchViolations } from '../api/graph-client';

const nodeTypes = {
  system: SystemNode,
  file: FileNode,
  entity: EntityNode,
};

const edgeTypes = {
  relation: RelationEdge,
  violation: ViolationEdge,
  cycle: CycleEdge,
};

function CanvasInner() {
  const { nodes: initialNodes, edges: initialEdges, loading, error } = useGraphData();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { runLayout } = useLayout();

  // Zustand state
  const drillInto = useCanvasStore((s) => s.drillInto);
  const activeOverlay = useCanvasStore((s) => s.activeOverlay);

  // Semantic zoom — keeps store in sync with viewport zoom level
  useSemanticZoom();

  // Extra data for overlays that need external data (cycles, violations)
  const [overlayData, setOverlayData] = useState<OverlayExtraData>({});

  // Fetch overlay-specific data when overlay changes
  useEffect(() => {
    let cancelled = false;

    if (activeOverlay === 'cycles') {
      fetchCycles()
        .then((data) => {
          if (!cancelled) setOverlayData({ cycles: data as OverlayExtraData['cycles'] });
        })
        .catch(() => {
          /* overlay data is optional */
        });
    } else if (activeOverlay === 'architecture-violations') {
      fetchViolations()
        .then((data) => {
          if (!cancelled) setOverlayData({ violations: data as OverlayExtraData['violations'] });
        })
        .catch(() => {
          /* overlay data is optional */
        });
    } else {
      setOverlayData({});
    }

    return () => {
      cancelled = true;
    };
  }, [activeOverlay]);

  // Sync hook data into React Flow's controlled state once loaded.
  useEffect(() => {
    if (initialNodes.length > 0) {
      setNodes(initialNodes);
      setEdges(initialEdges);
    }
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Apply overlay styles to nodes
  const overlayNodes = useMemo(
    () => applyOverlay(nodes, activeOverlay, overlayData),
    [nodes, activeOverlay, overlayData],
  );

  // Drill-down on double-click
  const handleNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      drillInto(node.id);
    },
    [drillInto],
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p>Loading graph data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'red' }}>
        <p>Error: {error}</p>
      </div>
    );
  }

  return (
    <>
      <BreadcrumbBar />
      <OverlayLegend />
      <ReactFlow
        nodes={overlayNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeDoubleClick={handleNodeDoubleClick}
        fitView
        minZoom={0.1}
        maxZoom={4}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <MiniMap
          nodeStrokeWidth={3}
          zoomable
          pannable
          style={{ width: 150, height: 100 }}
        />
      </ReactFlow>
    </>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
