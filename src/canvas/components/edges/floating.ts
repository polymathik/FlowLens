/**
 * Floating edge geometry (React Flow "Simple Floating Edges" example):
 * edges attach where the line between two node centres crosses each node's
 * border, instead of fixed top/bottom handles. Avoids the looping curves
 * that fixed handles produce in force-directed layouts.
 */
import { Position, useInternalNode, type InternalNode } from '@xyflow/react';

interface Point {
  x: number;
  y: number;
}

function box(node: InternalNode) {
  const { x, y } = node.internals.positionAbsolute;
  const w = node.measured.width ?? Number(node.style?.width ?? 0);
  const h = node.measured.height ?? Number(node.style?.height ?? 0);
  return { x, y, w, h };
}

/** Where the segment from `node`'s centre towards `other`'s centre exits `node`. */
export function borderIntersection(node: InternalNode, other: InternalNode): Point {
  const a = box(node);
  const b = box(other);
  const w2 = a.w / 2;
  const h2 = a.h / 2;
  const cx = a.x + w2;
  const cy = a.y + h2;
  const tx = b.x + b.w / 2;
  const ty = b.y + b.h / 2;
  if (w2 === 0 || h2 === 0) return { x: cx, y: cy };
  const xx1 = (tx - cx) / (2 * w2) - (ty - cy) / (2 * h2);
  const yy1 = (tx - cx) / (2 * w2) + (ty - cy) / (2 * h2);
  const k = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = k * xx1;
  const yy3 = k * yy1;
  return { x: w2 * (xx3 + yy3) + cx, y: h2 * (-xx3 + yy3) + cy };
}

/** Which side of `node` a border point lies on. */
export function sideOf(node: InternalNode, p: Point): Position {
  const a = box(node);
  const px = Math.round(p.x);
  const py = Math.round(p.y);
  if (px <= Math.round(a.x + 1)) return Position.Left;
  if (px >= Math.round(a.x + a.w - 1)) return Position.Right;
  if (py <= Math.round(a.y + 1)) return Position.Top;
  return Position.Bottom;
}

export interface FloatingEndpoints {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
}

/** Floating endpoints for an edge, or null until both nodes are measured. */
export function useFloatingEndpoints(source: string, target: string): FloatingEndpoints | null {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t || !s.measured.width || !t.measured.width) return null;
  const sp = borderIntersection(s, t);
  const tp = borderIntersection(t, s);
  return {
    sourceX: sp.x,
    sourceY: sp.y,
    targetX: tp.x,
    targetY: tp.y,
    sourcePosition: sideOf(s, sp),
    targetPosition: sideOf(t, tp),
  };
}

export interface SideEndpoints {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

/** Middle of the right border of both nodes (edges that swing out to the right of a stack of layers). */
export function useRightSideEndpoints(source: string, target: string): SideEndpoints | null {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t || !s.measured.width || !t.measured.width) return null;
  const a = box(s);
  const b = box(t);
  return { sourceX: a.x + a.w, sourceY: a.y + a.h / 2, targetX: b.x + b.w, targetY: b.y + b.h / 2 };
}
