/**
 * Canvas graph API app (`createGraphApp`, src/canvas/api/graph-app.ts):
 * what its embedders (the daemon's explorer routes, tests) pass in and get
 * back. Moved here from the implementation (Phase 12 review L6).
 */
import type { Request, Response, Router } from 'express';
import type { GraphStore } from '../graph.js';

/** Lends an open store for the duration of `fn` (read-only use). */
export interface GraphProvider {
  withGraph<T>(fn: (graph: GraphStore) => Promise<T>): Promise<T>;
}

/** Where `/events` subscribers go; defaults to a local SSE hub. */
export interface GraphEvents {
  subscribe(req: Request, res: Response): void;
}

export interface GraphAppOptions {
  graph: GraphStore | GraphProvider;
  rootDir: string;
  flowlensDir: string;
  events?: GraphEvents;
}

export interface GraphApp {
  router: Router;
  /** Push a named SSE event to local subscribers (only when `events` was not given). */
  broadcast: (type: string, payload: unknown) => void;
  /** End every local SSE stream. */
  closeEvents: () => void;
}
