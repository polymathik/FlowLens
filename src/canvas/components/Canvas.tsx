/**
 * Main canvas: header (toolbar, breadcrumb, stats) above a React Flow
 * surface with floating panels.
 *
 * Data flow:
 *   useGraphData → entities, relations, code hierarchy (shared with Health) + GraphIndex
 *   useMapModel → the OPEN container's children, links and portals → nodes/edges
 *   useCanvasLayout → deterministic layout, commit, then focus or fit
 *   useCanvasView → relation filter, overlay decoration, selection
 *   useHashRoute / useDrillUrl → deep links in, drill path out (back / forward work)
 *
 * Interaction: wheel / pinch zooms; drag pans; hold Shift and scroll to pan
 * with a trackpad or wheel. Off-screen elements are not rendered.
 */
import React, { useCallback, useMemo, useState } from 'react';
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
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphData } from '../hooks/useGraphData';
import { useOverlayData } from '../hooks/useOverlayData';
import { useMapModel } from '../hooks/useMapModel';
import { useCanvasView, type LayerView } from '../hooks/useCanvasView';
import { useCanvasLayout } from '../hooks/useCanvasLayout';
import { useSemanticZoom } from '../hooks/useSemanticZoom';
import { useNodeInteractions } from '../hooks/useNodeInteractions';
import { useZoneOverridesLoader } from '../hooks/useZoneOverrides';
import { useCommunityStateLoader, useCommunitySync } from '../hooks/useCommunityState';
import { useArchitectureLayersLoader, useLayerBreaks } from '../hooks/useLayerBreaks';
import { useCanvasStoreApi } from '../store/canvas-store';
import { expansionKey } from '../utils/zone-cut';
import { useHashRoute } from '../router/useHashRoute';
import { useDrillUrl } from '../router/useDrillUrl';
import { useFocusUrl } from '../router/useFocusUrl';
import { useFocusActions } from '../focus/focus-actions';
import { useFocusKeys } from '../focus/useFocusKeys';
import { FocusBar } from '../focus/FocusBar';
import { FocusButton } from '../focus/FocusButton';
import { useFlowUrl } from '../flow/useFlowUrl';
import { useFlowActions } from '../flow/flow-actions';
import { useFlowKeys } from '../flow/useFlowKeys';
import { FlowButton } from '../flow/FlowButton';
import { FlowLayer } from '../flow/ui/FlowLayer';
import type { FocusEmphasis } from '../focus/focus-emphasis';
import type { CanvasEdgeData } from '../../contracts/canvas/index.js';
import { exportCanvas, type ExportFormat } from '../utils/export-utils';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges/edges';
import { CanvasHeader } from './panels/CanvasHeader';
import { FilterPanel } from './panels/FilterPanel';
import { SearchPanel } from './panels/SearchPanel';
import { DetailPanel } from './panels/DetailPanel';
import { OverlayLegend } from './panels/OverlayLegend';
import { ZoneControls } from './panels/ZoneControls';
import { ZoneMenu, type MenuTarget } from './panels/ZoneMenu';
import { ZoneNotice } from './panels/ZoneNotice';
import { ZoneActionsContext, type ZoneActions } from './nodes/zone-actions';
import { ArchitectureEditor } from './panels/rules/ArchitectureEditor';
import { MINIMAP_STROKE } from './nodes/NodeShell';
import { useColorMode } from './explorer/theme';
import { TimelineBar, TimelineOverlays, TimelineProvider, TimelineToggle, useTimelineGraph, useTimelineView } from '../timeline';
import { COLORS } from './shared/ui';

function Centered({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: tone ? COLORS.danger : COLORS.muted }}>
      {children}
    </div>
  );
}

const minimapColor = (n: Node) =>
  n.type === 'zone'
    ? `rgb(var(--fl-zone-${(n.data as { colorIndex?: number }).colorIndex ?? 5}) / 0.55)`
    : (MINIMAP_STROKE[(n.type as keyof typeof MINIMAP_STROKE) ?? 'entity'] ?? 'var(--fl-minimap-entity)');

function CanvasInner() {
  const graph = useGraphData();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [layoutEdges, setLayoutEdges] = useState<Edge[]>([]);
  const [showFilter, setShowFilter] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const store = useCanvasStoreApi();
  const shiftHeld = useKeyPress('Shift');
  const colorMode = useColorMode();

  useZoneOverridesLoader();
  useCommunityStateLoader();
  useArchitectureLayersLoader();
  const overlayData = useOverlayData(graph.version);
  const tl = useTimelineGraph(graph);
  const model = useMapModel(tl.graph);
  const containerId = model.view.containerId;
  useCommunitySync(tl.active ? { ...model.view, zoning: undefined } : model.view, graph.hierarchy);
  const zoneActions = useMemo<ZoneActions>(
    () => ({
      toggle: (itemId, expanded) => store.getState().setZoneExpansion({ [expansionKey(containerId, itemId)]: expanded }),
      openMenu: (nodeId, x, y) => setMenu({ nodeId, x, y }),
    }),
    [store, containerId],
  );
  const commit = useCallback(
    (laidOut: Node[], edges: Edge[]) => {
      setNodes(laidOut);
      setLayoutEdges(edges);
    },
    [setNodes],
  );
  const breaks = useLayerBreaks(graph, model.view);
  const layerView = useMemo<LayerView | undefined>(
    () => (model.view.zoning?.mode === 'layers' && model.view.zoning.zoneSet.zones.length > 0 ? { breaks, relationById: graph.relationById, topIds: model.view.cut?.topIds ?? [] } : undefined),
    [breaks, graph.relationById, model.view],
  );
  const focusView = useMemo<FocusEmphasis | undefined>(
    () => (model.view.focus && model.view.cut ? { info: model.view.focus, atomOfFile: model.view.cut.atomOfFile } : undefined),
    [model.view],
  );
  const view = useCanvasView(nodes, layoutEdges as Edge<CanvasEdgeData>[], graph.index, overlayData, layerView, focusView);
  const focusActions = useFocusActions(graph.hierarchy);
  useFocusKeys(focusActions, !!menu || showRules);
  const flowActions = useFlowActions(graph.hierarchy, graph.index.entityById);
  useFlowKeys(flowActions, !!menu || showRules);
  const focusCards = model.view.cut?.items.filter((i) => i.kind === 'file' || !i.expanded).length ?? 0;
  const shown = useTimelineView(view.displayNodes, view.displayEdges, model.view, tl.graph.hierarchy);
  useCanvasLayout({ model, visibleIds: view.visibleIds, commit });
  useSemanticZoom();
  useHashRoute(graph.entities, graph.hierarchy, !graph.loading && graph.entities.length > 0);
  useDrillUrl(graph.hierarchy, !graph.loading && graph.entities.length > 0);
  useFocusUrl(graph.hierarchy, !graph.loading && graph.entities.length > 0);
  useFlowUrl(graph.hierarchy, !graph.loading && graph.entities.length > 0);
  const handlers = useNodeInteractions(graph.index.entityById, graph.hierarchy);

  const onExport = useCallback(
    (format: ExportFormat) => {
      setExporting(true);
      exportCanvas(format, view.displayNodes)
        .catch((err) => console.error('[flowlens] export failed', err))
        .finally(() => setExporting(false));
    },
    [view.displayNodes],
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
        hierarchy={graph.hierarchy}
        showFilter={showFilter}
        showRules={showRules}
        onToggleFilter={() => setShowFilter((v) => !v)}
        onToggleRules={() => setShowRules((v) => !v)}
        onExport={onExport}
        exporting={exporting}
        zoneControls={<><ZoneControls view={model.view} hierarchy={graph.hierarchy} onOpenRules={() => setShowRules(true)} /><TimelineToggle /></>}
        focusButton={<FocusButton actions={focusActions} />}
        flowButton={<FlowButton actions={flowActions} />}
        focusInfo={model.view.focus}
        focusBar={<FocusBar info={model.view.focus} cards={focusCards} onExit={focusActions.exit} />}
      />
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <ZoneActionsContext.Provider value={zoneActions}>
        <ReactFlow
          nodes={shown.nodes}
          edges={shown.edges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={handlers.onNodeClick}
          onNodeDoubleClick={handlers.onNodeDoubleClick}
          onEdgeClick={handlers.onEdgeClick}
          onPaneClick={handlers.onPaneClick}
          onNodeMouseEnter={handlers.onNodeMouseEnter}
          onNodeMouseLeave={handlers.onNodeMouseLeave}
          minZoom={0.02}
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
        </ZoneActionsContext.Provider>
        <FlowLayer actions={flowActions} entities={graph.entities} entityById={graph.index.entityById} />
        <ZoneNotice view={model.view} />
        <TimelineOverlays frame={shown.frame} notApplicable={shown.notApplicable} />
        {menu && <ZoneMenu target={menu} view={model.view} hierarchy={graph.hierarchy} onClose={() => setMenu(null)} />}
        {showFilter && <FilterPanel />}
        {showRules && <ArchitectureEditor onClose={() => setShowRules(false)} />}
        <OverlayLegend nodes={view.displayNodes} />
        <DetailPanel graph={graph} edges={view.displayEdges} />
      </div>
      <TimelineBar items={shown.items} ghosts={tl.ghosts} frame={shown.frame} />
      <SearchPanel entities={graph.entities} hierarchy={graph.hierarchy} />
    </div>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <TimelineProvider>
        <CanvasInner />
      </TimelineProvider>
    </ReactFlowProvider>
  );
}
