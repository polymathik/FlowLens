/**
 * PNG / SVG export of the current canvas view.
 *
 * Follows React Flow's documented approach (reactflow.dev "Download Image"
 * example): render `.react-flow__viewport` with html-to-image, using
 * `getNodesBounds` + `getViewportForBounds` to frame every visible node
 * regardless of the on-screen pan/zoom. html-to-image inlines computed
 * styles into a `<foreignObject>`, which is what the previous hand-rolled
 * `<svg>` wrapper lacked (it produced blank files).
 *
 * html-to-image is pinned to 1.11.11 — the React Flow example notes later
 * releases do not export correctly.
 */
import { toPng, toSvg } from 'html-to-image';
import { getNodesBounds, getViewportForBounds, type Node, type Viewport } from '@xyflow/react';

export type ExportFormat = 'png' | 'svg';

export interface ExportFrame {
  width: number;
  height: number;
  viewport: Viewport;
}

const MARGIN = 64;
const MIN_SIZE = { width: 640, height: 400 };
const MAX_SIDE = 4096;

/** Image size and viewport transform that frame `bounds` at ~1:1 scale. */
export function computeExportFrame(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): ExportFrame {
  const width = Math.round(Math.min(Math.max(bounds.width + MARGIN * 2, MIN_SIZE.width), MAX_SIDE));
  const height = Math.round(Math.min(Math.max(bounds.height + MARGIN * 2, MIN_SIZE.height), MAX_SIDE));
  const viewport = getViewportForBounds(bounds, width, height, 0.05, 1.5, 0.05);
  return { width, height, viewport };
}

/** Elements html-to-image should skip (minimap, controls, attribution). */
function exportFilter(node: HTMLElement): boolean {
  const cls = node.classList;
  if (!cls) return true;
  return !(
    cls.contains('react-flow__minimap') ||
    cls.contains('react-flow__controls') ||
    cls.contains('react-flow__panel')
  );
}

/** Render the visible nodes to a data URL. */
export async function renderCanvasImage(format: ExportFormat, nodes: Node[]): Promise<string> {
  const el = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!el) throw new Error('Canvas viewport not found');
  if (nodes.length === 0) throw new Error('Nothing to export');
  const frame = computeExportFrame(getNodesBounds(nodes));
  const { x, y, zoom } = frame.viewport;
  const options = {
    backgroundColor: '#ffffff',
    width: frame.width,
    height: frame.height,
    filter: exportFilter,
    style: {
      width: `${frame.width}px`,
      height: `${frame.height}px`,
      transform: `translate(${x}px, ${y}px) scale(${zoom})`,
    },
  };
  return format === 'png' ? toPng(el, { ...options, pixelRatio: 2 }) : toSvg(el, options);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function exportCanvas(format: ExportFormat, nodes: Node[]): Promise<void> {
  const dataUrl = await renderCanvasImage(format, nodes);
  downloadDataUrl(dataUrl, `flowlens-graph.${format}`);
}
