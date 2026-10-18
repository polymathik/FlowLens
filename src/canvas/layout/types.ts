/** Layout engine inputs/outputs: plain boxes and links, no React Flow instance needed (unit-testable). */
export interface LayoutBox {
  id: string;
  width: number;
  height: number;
  /** Pin to the first / last layer (incoming / outgoing portals). */
  pin?: 'first' | 'last';
}

export interface LayoutLink {
  source: string;
  target: string;
}

export type Positions = Map<string, { x: number; y: number }>;
