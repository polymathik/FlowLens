/**
 * Canvas layout contract — the interface a layout engine must satisfy.
 * Phase 5 ships an ELK.js implementation and a d3-force implementation;
 * both consume `LayoutOptions` and produce positioned React Flow nodes.
 */
import type { CanvasNode, CanvasEdge } from './data.js';

export type LayoutAlgorithm = 'layered' | 'force' | 'tree';
export type LayoutDirection = 'DOWN' | 'RIGHT' | 'UP' | 'LEFT';

export interface LayoutOptions {
  algorithm: LayoutAlgorithm;
  direction: LayoutDirection;
  spacing: {
    /** Minimum distance between sibling nodes. */
    node: number;
    /** Minimum distance between layered rows/columns. */
    layer: number;
  };
  /** When true, group nodes by `parentId` to respect compound boundaries. */
  compactGroups: boolean;
}

export interface LayoutEngine {
  /**
   * Compute positions for a set of nodes and edges.
   * Must return new node objects (immutability) with updated `position`.
   */
  computeLayout(
    nodes: CanvasNode[],
    edges: CanvasEdge[],
    options: LayoutOptions,
  ): Promise<{ nodes: CanvasNode[]; edges: CanvasEdge[] }>;
}

/** Default options used by the layered ELK strategy. */
export const DEFAULT_LAYERED_OPTIONS: LayoutOptions = {
  algorithm: 'layered',
  direction: 'DOWN',
  spacing: { node: 30, layer: 60 },
  compactGroups: true,
};

/** Default options used by the force-directed strategy. */
export const DEFAULT_FORCE_OPTIONS: LayoutOptions = {
  algorithm: 'force',
  direction: 'DOWN',
  spacing: { node: 120, layer: 120 },
  compactGroups: false,
};
