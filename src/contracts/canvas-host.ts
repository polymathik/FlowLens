/**
 * Canvas host contract — how `flowlens canvas` serves the canvas SPA and
 * the graph API from ONE local HTTP server.
 *
 * Production mode serves the pre-built bundle (`dist/canvas/app`) with
 * `express.static`; dev mode (contributors, source checkout only) mounts
 * Vite in middleware mode for HMR. Both modes expose the graph API under
 * `/flowlens-api/*` on the same origin, so the SPA's relative API base
 * works unchanged.
 */

export type CanvasHostMode = 'static' | 'dev';

export interface CanvasHostOptions {
  /** Absolute path to the project's `.flowlens/` directory. */
  flowlensDir: string;
  /** Public port for SPA + API. 0 = pick a free port. */
  port: number;
  /** Interface to bind. Defaults to `127.0.0.1` (local-only). */
  host?: string;
  mode: CanvasHostMode;
  /** Internal graph-API port (0/undefined = pick a free loopback port). */
  apiPort?: number;
}

export interface CanvasHost {
  /** URL the user opens, e.g. `http://127.0.0.1:5173/`. */
  url: string;
  port: number;
  mode: CanvasHostMode;
  /** Push a named SSE event to every connected canvas (watch mode). */
  broadcast: (type: string, payload: unknown) => void;
  close: () => Promise<void>;
}

/** Thrown when the requested mode cannot run in this installation. */
export class CanvasHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanvasHostError';
  }
}
