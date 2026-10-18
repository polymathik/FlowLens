/**
 * Main canvas: header (toolbar, breadcrumb, stats) above a React Flow
 * surface with floating panels.
 *
 * Data flow:
 *   useGraphData → all nodes (all levels) + GraphIndex
 *   useCanvasView → visible nodes for the drill path, aggregated edges,
 *                   overlay decoration, relation filters, problem edges
 *   useCanvasLayout → layout on visible-set change, then focus or fit
 *   useHashRoute → deep links (#/entity/<id>?overlay=…)
 *
 * Interaction: wheel / pinch zooms; drag pans; hold Shift and scroll to pan
 * with a trackpad or wheel. Off-screen elements are not rendered.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  useKeyPress,
  useNodesState,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphData } from '../hooks/useGraphData';
import { useOverlayData } from '../hooks/useOverlayData';
import { useCanvasView } from '../hooks/useCanvasView';
import { useCanvasLayout } from '../hooks/useCanvasLayout';
import { useSemanticZoom } from '../hooks/useSemanticZoom';
import { useNodeInteractions } from '../hooks/useNodeInteractions';
import { useHashRoute } from '../router/useHashRoute';
import { exportCanvas, type ExportFormat } from '../utils/export-utils';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges/edges';
import { CanvasHeader } from './panels/CanvasHeader';
import { FilterPanel } from './panels/FilterPanel';
import { SearchPanel } from './panels/SearchPanel';
import { DetailPanel } from './panels/DetailPanel';
import { OverlayLegend } from './panels/OverlayLegend';
import { ArchitectureEditor } from './panels/rules/ArchitectureEditor';
import { MINIMAP_STROKE } from './nodes/NodeShell';
import { useColorMode } from './explorer/theme';
import { COLORS } from './shared/ui';

function Centered({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: tone ? COLORS.danger : COLORS.muted }}>
      {children}
    </div>
  );
}

const minimapColor = (n: Node) => MINIMAP_STROKE[(n.type as keyof typeof MINIMAP_STROKE) ?? 'entity'] ?? '#cbd5e1';

function CanvasInner() {
  const graph = useGraphData();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [showFilter, setShowFilter] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [exporting, setExporting] = useState(false);
  const shiftHeld = useKeyPress('Shift');
  const colorMode = useColorMode();

  useEffect(() => setNodes(graph.nodes), [graph.nodes, setNodes]);

  const overlayData = useOverlayData(graph.version);
  const view = useCanvasView(nodes, graph.relations, graph.index, overlayData, graph.version);
  useCanvasLayout({ ...view, setNodes });
  useSemanticZoom();
  const allNodeIds = useMemo(() => new Set(graph.nodes.map((n) => n.id)), [graph.nodes]);
  useHashRoute(graph.entities, allNodeIds, !graph.loading && graph.nodes.length > 0);
  const handlers = useNodeInteractions(graph.index.entityById);

  const onExport = useCallback(
    (format: ExportFormat) => {
      setExporting(true);
      exportCanvas(format, view.layoutNodes)
        .catch((err) => console.error('[flowlens] export failed', err))
        .finally(() => setExporting(false));
    },
    [view.layoutNodes],
  );

  if (graph.loading) return <Centered>Loading graph…</Centered>;
  if (graph.error) return <Centered tone="error">Could not load the graph: {graph.error}</Centered>;
  if (graph.entities.length === 0) return <Centered>Nothing is indexed in this project yet. Run “flowlens index” in its folder; this tab updates by itself.</Centered>;

  return (
    <div
      data-testid="map-view"
      data-graph-version={graph.version}
      data-node-count={graph.entities.length}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: COLORS.canvas }}
    >
      <CanvasHeader
        graphVersion={graph.version}
        showFilter={showFilter}
        showRules={showRules}
        onToggleFilter={() => setShowFilter((v) => !v)}
        onToggleRules={() => setShowRules((v) => !v)}
        onExport={onExport}
        exporting={exporting}
      />
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <ReactFlow
          nodes={view.displayNodes}
          edges={view.displayEdges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={handlers.onNodeClick}
          onNodeDoubleClick={handlers.onNodeDoubleClick}
          onPaneClick={handlers.onPaneClick}
          minZoom={0.05}
          maxZoom={4}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          panOnScroll={shiftHeld}
          panOnScrollMode={PanOnScrollMode.Free}
          onlyRenderVisibleElements
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          colorMode={colorMode}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <Controls showInteractive={false} />
          <MiniMap nodeColor={minimapColor} nodeStrokeWidth={2} zoomable pannable style={{ width: 150, height: 100 }} />
        </ReactFlow>
        {showFilter && <FilterPanel />}
        {showRules && <ArchitectureEditor onClose={() => setShowRules(false)} />}
        <OverlayLegend nodes={view.displayNodes} />
        <DetailPanel entityById={graph.index.entityById} />
      </div>
      <SearchPanel entities={graph.entities} />
    </div>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
