/**
 * Main React Flow canvas component.
 *
 * Wraps the graph in a ReactFlowProvider and renders Background, Controls,
 * and MiniMap alongside the nodes/edges loaded from the graph API.
 * Uses custom node types (System, File, Entity) and ELK.js auto-layout.
 */
import React from 'react';
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
import { SystemNode } from './nodes/SystemNode';
import { FileNode } from './nodes/FileNode';
import { EntityNode } from './nodes/EntityNode';

const nodeTypes = {
  system: SystemNode,
  file: FileNode,
  entity: EntityNode,
};

function CanvasInner() {
  const { nodes: initialNodes, edges: initialEdges, loading, error } = useGraphData();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { runLayout } = useLayout();

  // Sync hook data into React Flow's controlled state once loaded.
  React.useEffect(() => {
    if (initialNodes.length > 0) {
      setNodes(initialNodes);
      setEdges(initialEdges);
    }
  }, [initialNodes, initialEdges, setNodes, setEdges]);

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
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
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
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
