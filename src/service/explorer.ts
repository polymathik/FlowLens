/**
 * mountExplorer — the daemon's default `MountRoutes` hook: browser sign-in,
 * per-project canvas + health routes, and the SPA itself.
 *
 * ```mermaid
 * flowchart LR
 *   CLI["flowlens canvas"] -->|"POST /api/auth/code (bearer)"| D[daemon]
 *   CLI -->|opens| B[Browser]
 *   B -->|"GET /auth?t=code"| D
 *   D -->|"Set-Cookie (HttpOnly, SameSite=Strict) + 303 /#/p/:id/health"| B
 *   B -->|"GET /, /assets/*"| S[static SPA]
 *   B -->|"cookie: /api/projects, /canvas/*, /health*, /events"| D
 * ```
 */
import type { Express } from 'express';
import type { MountRoutes, ServiceDeps } from './app.js';
import { mountExplorerAuth } from './explorer-auth.js';
import { createExplorerProjectState, mountExplorerProjects } from './explorer-projects.js';
import { mountExplorerStatic } from './explorer-static.js';
import { SessionStore } from './sessions.js';
import type { CanvasLocations } from '../cli/canvas-host/package-paths.js';

export function createExplorerMount(o: { locations?: CanvasLocations } = {}): MountRoutes {
  return (app: Express, deps: ServiceDeps) => {
    const sessions = deps.sessions ?? (deps.sessions = new SessionStore());
    mountExplorerAuth(app, deps, sessions);
    mountExplorerProjects(app, deps, createExplorerProjectState());
    mountExplorerStatic(app, o.locations);
  };
}

export const mountExplorer: MountRoutes = createExplorerMount();
