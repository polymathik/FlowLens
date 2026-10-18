/**
 * Details for the selected node or edge: what it is, where it lives, its
 * metrics, and the relations behind it with their reference lines
 * ("imported at src/index.ts:12") plus an "Open in editor" link.
 */
import React, { useMemo } from 'react';
import type { Edge } from '@xyflow/react';
import type { Entity, Relation } from '../../api/graph-client';
import type { CanvasEdgeData, EditorScheme } from '../../../contracts/canvas/index.js';
import { EDITOR_SCHEMES } from '../../../contracts/canvas/index.js';
import type { GraphData } from '../../hooks/useGraphData';
import { useCanvasStore } from '../../store/canvas-store';
import { EDITOR_LABELS, editorUrl } from '../../utils/editor-link';
import { describeCounts } from '../../utils/relation-labels';
import { useProjectContext } from '../explorer/project-context';
import { FocusOnThis } from '../../focus/FocusOnThis';
import { TraceFromHere } from '../../flow/TraceFromHere';
import { EntityIcon } from '../shared/EntityIcon';
import { MetricsBadge } from '../shared/MetricsBadge';
import { COLORS, floatingPanel, linkButton } from '../shared/ui';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '1px 0' }}>
      <span style={{ color: COLORS.muted }}>{label}</span>
      <span style={{ textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

const round = (n: number) => (Math.round(n * 100) / 100).toString();
const VERB: Record<string, string> = { import: 'imported', call: 'called', extend: 'extended', implement: 'implemented', create: 'created', use: 'used' };

function EditorLink({ file, line, column, label }: { file: string; line?: number; column?: number; label?: string }) {
  const { projectRoot } = useProjectContext();
  const scheme = useCanvasStore((s) => s.editorScheme);
  const href = editorUrl(scheme, projectRoot, file, line, column);
  if (!href) return <span>{label ?? `${file}${line ? `:${line}` : ''}`}</span>;
  return (
    <a data-testid="open-in-editor" href={href} title={`Open in ${EDITOR_LABELS[scheme]}`} style={{ color: COLORS.accent }}>
      {label ?? `${file}${line ? `:${line}` : ''}`}
    </a>
  );
}

function RelationLines({ relations, entityById, title }: { relations: Relation[]; entityById: Map<string, Entity>; title: string }) {
  if (relations.length === 0) return null;
  const name = (id: string) => entityById.get(id)?.name ?? id.split('/').pop() ?? id;
  return (
    <div data-testid="relation-lines" style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 650, marginBottom: 2 }}>{title}</div>
      {relations.slice(0, 12).map((r) => (
        <div key={r.id} style={{ display: 'flex', flexDirection: 'column', padding: '2px 0', borderTop: `1px solid ${COLORS.border}` }}>
          <span style={{ wordBreak: 'break-all' }}>
            {name(r.from)} <span style={{ color: COLORS.muted }}>{r.type}</span> {name(r.to)}
          </span>
          <span style={{ color: COLORS.muted, fontSize: 11 }}>
            {VERB[r.type] ?? r.type} at <EditorLink file={r.location.file} line={r.location.line} column={r.location.column} />
          </span>
        </div>
      ))}
      {relations.length > 12 && <div style={{ color: COLORS.faint }}>…and {relations.length - 12} more</div>}
    </div>
  );
}

function EditorChoice() {
  const scheme = useCanvasStore((s) => s.editorScheme);
  const setScheme = useCanvasStore((s) => s.setEditorScheme);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: COLORS.muted }}>
      Open links in
      <select data-testid="editor-scheme" value={scheme} onChange={(e) => setScheme(e.target.value as EditorScheme)} style={{ fontSize: 11 }}>
        {EDITOR_SCHEMES.map((s) => (
          <option key={s} value={s}>
            {EDITOR_LABELS[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

function Frame({ header, onClose, children }: { header: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div data-testid="detail-panel" style={{ ...floatingPanel, bottom: 16, left: 16, padding: '12px 16px', width: 320, maxHeight: '55vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {header}
        <button aria-label="Close details" style={{ ...linkButton, color: COLORS.faint }} onClick={onClose}>
          ×
        </button>
      </div>
      {children}
      <EditorChoice />
    </div>
  );
}

export function DetailPanel({ graph, edges }: { graph: Pick<GraphData, 'index' | 'hierarchy' | 'relations' | 'relationById'>; edges: Edge<CanvasEdgeData>[] }) {
  const selectedId = useCanvasStore((s) => s.selectedNodeId);
  const selectedEdge = useCanvasStore((s) => s.selectedEdgeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const selectEdge = useCanvasStore((s) => s.selectEdge);
  const visibleTypes = useCanvasStore((s) => s.visibleRelationTypes);
  const { entityById } = graph.index;
  const node = selectedId ? graph.hierarchy.nodes.get(selectedId) : undefined;
  const entity = selectedId ? entityById.get(selectedId) : undefined;
  const related = useMemo(() => {
    if (!entity) return { out: [] as Relation[], inc: [] as Relation[] };
    const structural = (r: Relation) => r.type !== 'contain' && !!r.to;
    return {
      out: graph.relations.filter((r) => r.from === entity.id && structural(r)),
      inc: graph.relations.filter((r) => r.to === entity.id && structural(r)),
    };
  }, [entity, graph.relations]);

  if (selectedEdge) {
    const edge = edges.find((e) => e.id === selectedEdge);
    if (!edge?.data?.relationIds) return null;
    const relations = edge.data.relationIds.map((id) => graph.relationById.get(id)).filter((r): r is Relation => !!r && visibleTypes.has(r.type));
    return (
      <Frame header={<span data-testid="edge-detail-title" style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{edge.data.breakLabel ?? `${relations.length} relations`}</span>} onClose={() => selectEdge(null)}>
        {edge.data.ruleText && <div data-testid="edge-rule" style={{ color: COLORS.danger, marginBottom: 4 }}>{edge.data.ruleText}</div>}
        <div style={{ color: COLORS.muted, marginBottom: 4 }}>{describeCounts(countTypes(relations))}</div>
        <RelationLines relations={relations} entityById={entityById} title={edge.data.breakLabel ? 'Where the rule is broken' : 'Where they are written'} />
      </Frame>
    );
  }
  if (!node) return null;
  const m = entity?.metrics;
  return (
    <Frame
      onClose={() => selectNode(null)}
      header={
        <>
          {entity ? <EntityIcon kind={entity.kind} /> : <span aria-hidden>{node.kind === 'file' ? '▤' : node.kind === 'package' ? '◈' : '▸'}</span>}
          <span style={{ fontWeight: 700, fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
          <MetricsBadge score={m?.quality_score ?? node.stats.quality} />
        </>
      }
    >
      <div style={{ color: COLORS.muted, marginBottom: 8, fontSize: 11, wordBreak: 'break-all' }}>{entity?.qualified_name ?? (node.path || '.')}</div>
      <FocusOnThis nodeId={node.id} hierarchy={graph.hierarchy} />
      <TraceFromHere nodeId={node.id} hierarchy={graph.hierarchy} entityById={entityById} />
      <Row label="Kind" value={entity?.kind ?? node.kind} />
      {node.kind !== 'symbol' && <Row label="Contains" value={`${node.stats.folders ? `${node.stats.folders} folders · ` : ''}${node.stats.files} files · ${node.stats.symbols} symbols`} />}
      {node.kind !== 'project' && node.kind !== 'folder' && node.kind !== 'package' && node.kind !== 'config' && (
        <Row label="File" value={<EditorLink file={node.path} line={entity?.location?.line_start} column={entity?.location?.column_start} label={node.path} />} />
      )}
      {entity && <Row label="Lines" value={`${entity.location?.line_start}–${entity.location?.line_end}`} />}
      {entity && <Row label="Visibility" value={entity.visibility} />}
      {m?.cognitive_complexity !== undefined && <Row label="Complexity (how hard to follow)" value={m.cognitive_complexity} />}
      {m?.line_count !== undefined && <Row label="Line count" value={m.line_count} />}
      {m?.churn_rate !== undefined && <Row label="Changes per day (90 d)" value={round(m.churn_rate)} />}
      {m?.hotspot_score !== undefined && <Row label="Hotspot score" value={round(m.hotspot_score)} />}
      <RelationLines relations={related.inc} entityById={entityById} title={`Used by (${related.inc.length})`} />
      <RelationLines relations={related.out} entityById={entityById} title={`Depends on (${related.out.length})`} />
    </Frame>
  );
}

function countTypes(relations: Relation[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of relations) out[r.type] = (out[r.type] ?? 0) + 1;
  return out;
}
