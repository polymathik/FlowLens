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
 * - Breadcrumb drill-down navigation (filters nodes by drill state)
 * - Edge filtering by visible relation types
 * - Overlay system (complexity, churn, hotspot, cycles, violations, diff)
 * - Custom edge types (relation, violation, cycle)
 * - Panels: toolbar, filter, search, detail, architecture editor
 * - SVG/PNG export
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  BackgroundVariant,
  PanOnScrollMode,
  type Node,
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
import { Toolbar } from './panels/Toolbar';
import { FilterPanel } from './panels/FilterPanel';
import { SearchPanel } from './panels/SearchPanel';
import { DetailPanel } from './panels/DetailPanel';
import { ArchitectureEditor } from './panels/ArchitectureEditor';
import { OverlayLegend } from './overlays/OverlayLegend';
import { applyOverlay, type OverlayExtraData } from './overlays/OverlayManager';
import { fetchCycles, fetchViolations, fetchDiff } from '../api/graph-client';
import { exportToSVG, exportToPNG } from '../utils/export-utils';
import { transformRelationsToEdges } from '../utils/edge-transformer';

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

/**
 * Given all nodes and the current drill state, return only the nodes
 * that should be visible.
 *
 * Flat node strategy — no parentId nesting. Parent references are stored
 * in node data: data.parentSystem (file nodes) and data.parentFile (entity nodes).
 *
 * - No drill: show only system-level nodes (type === 'system').
 * - Drilled into a system node: show file nodes whose data.parentSystem matches.
 * - Drilled into a file node: show entity nodes whose data.parentFile matches.
 */
function getVisibleNodes(
  allNodes: Node[],
  drillPath: string[],
): Node[] {
  if (drillPath.length === 0) {
    // Top-level view: only system nodes
    return allNodes.filter((n) => n.type === 'system');
  }

  const currentDrill = drillPath[drillPath.length - 1];

  return allNodes.filter((n) => {
    // The drilled-into node itself
    if (n.id === currentDrill) return true;
    // File nodes whose parentSystem matches the drilled system node
    const parentSystem = (n.data as Record<string, unknown>)?.parentSystem;
    if (parentSystem === currentDrill) return true;
    // Entity nodes whose parentFile matches the drilled file node
    const parentFile = (n.data as Record<string, unknown>)?.parentFile;
    if (parentFile === currentDrill) return true;
    // Show sibling system nodes for context when at first drill level
    if (n.type === 'system' && drillPath.length === 1) return true;
    return false;
  });
}

function CanvasInner() {
  const {
    nodes: initialNodes,
    entities,
    relations: rawRelations,
    loading,
    error,
  } = useGraphData();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const { runLayout } = useLayout();

  // Zustand state
  const drillInto = useCanvasStore((s) => s.drillInto);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const activeOverlay = useCanvasStore((s) => s.activeOverlay);
  const visibleTypes = useCanvasStore((s) => s.visibleRelationTypes);
  const drillPath = useCanvasStore((s) => s.drillPath);
  const diffSha = useCanvasStore((s) => s.diffSha);

  // Semantic zoom — keeps store in sync with viewport zoom level
  useSemanticZoom();

  // Panel visibility toggles
  const [showFilter, setShowFilter] = useState(false);
  const [showArchEditor, setShowArchEditor] = useState(false);

  // Extra data for overlays that need external data (cycles, violations, diff)
  const [overlayData, setOverlayData] = useState<OverlayExtraData>({});

  // Fetch overlay-specific data when overlay changes
  useEffect(() => {
    let cancelled = false;

    if (activeOverlay === 'cycles') {
      fetchCycles()
        .then((data) => {
          if (!cancelled)
            setOverlayData({ cycles: data as OverlayExtraData['cycles'] });
        })
        .catch(() => {
          /* overlay data is optional */
        });
    } else if (activeOverlay === 'architecture-violations') {
      fetchViolations()
        .then((data) => {
          if (!cancelled)
            setOverlayData({
              violations: data as OverlayExtraData['violations'],
            });
        })
        .catch(() => {
          /* overlay data is optional */
        });
    } else if (activeOverlay === 'interface-diff' && diffSha) {
      fetchDiff(diffSha)
        .then((data) => {
          if (!cancelled)
            setOverlayData({
              diffChanges: (data.changes ?? []) as OverlayExtraData['diffChanges'],
            });
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
  }, [activeOverlay, diffSha]);

  // Sync hook data into React Flow's controlled state once loaded.
  useEffect(() => {
    if (initialNodes.length > 0) {
      setNodes(initialNodes);
    }
  }, [initialNodes, setNodes]);

  // Apply overlay styles to nodes
  const overlayNodes = useMemo(
    () => applyOverlay(nodes, activeOverlay, overlayData),
    [nodes, activeOverlay, overlayData],
  );

  // Filter nodes by drill-down state (Issue 6)
  const visibleNodes = useMemo(
    () => getVisibleNodes(overlayNodes, drillPath),
    [overlayNodes, drillPath],
  );

  // Recompute edges reactively based on visible nodes + raw relations.
  // This ensures drill-down creates proper file-level / entity-level edges.
  const computedEdges = useMemo(() => {
    if (!rawRelations || rawRelations.length === 0) return [];
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    return transformRelationsToEdges(rawRelations, visibleNodeIds, entities);
  }, [visibleNodes, rawRelations, entities]);

  // Filter edges by visible relation types
  const filteredEdges = useMemo(() => {
    return computedEdges.filter((e) => {
      const data = e.data as Record<string, unknown> | undefined;
      // Entity-level edges have a relation object with a type
      const relation = data?.relation as { type?: string } | undefined;
      if (relation?.type) return visibleTypes.has(relation.type);
      // Aggregated edges have a types array
      const types = data?.types as string[] | undefined;
      if (types && types.length > 0) {
        return types.some((t) => visibleTypes.has(t));
      }
      return true;
    });
  }, [computedEdges, visibleTypes]);

  // Drill-down on double-click
  const handleNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      drillInto(node.id);
    },
    [drillInto],
  );

  // Select node on single-click
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  // Deselect when clicking on the pane
  const handlePaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
        }}
      >
        <p>Loading graph data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'red',
        }}
      >
        <p>Error: {error}</p>
      </div>
    );
  }

  return (
    <>
      <Toolbar
        onExportSVG={exportToSVG}
        onExportPNG={exportToPNG}
        onToggleFilter={() => setShowFilter((v) => !v)}
        onToggleArchEditor={() => setShowArchEditor((v) => !v)}
      />
      <BreadcrumbBar />
      {showFilter && <FilterPanel />}
      <SearchPanel entities={entities} />
      <DetailPanel entities={entities} />
      <ArchitectureEditor
        open={showArchEditor}
        onClose={() => setShowArchEditor(false)}
      />
      <OverlayLegend />
      <ReactFlow
        nodes={visibleNodes}
        edges={filteredEdges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        minZoom={0.05}
        maxZoom={4}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll={false}
        zoomOnPinch
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
