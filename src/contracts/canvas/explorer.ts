/**
 * Multi-project explorer contract (Phase 11, audit §6.1).
 *
 * The FlowLens daemon serves the explorer UI at `/` and, per registered
 * project, the canvas graph API and the health engine:
 *
 *   GET  /                                   explorer SPA (public, no secrets)
 *   GET  /auth?t=<one-time code>             exchange code → session cookie, 303 → /#…
 *   POST /api/auth/code        (bearer only) mint a one-time code for the browser
 *   GET  /api/session                        who am I (cookie or bearer)
 *   GET  /api/projects                       ProjectDetail[] (existing route)
 *   DELETE /api/projects/:id                 remove from the registry ("Remove from list")
 *   GET  /api/projects/:id/canvas/*          canvas graph API (contracts/canvas/api.ts)
 *   GET  /api/projects/:id/health            HealthReport (cached per graph revision)
 *   GET  /api/projects/:id/health/summary    ExplorerHealthSummary (Home card)
 *   GET  /api/projects/:id/health/report?format=html|md   download
 *   GET  /api/projects/:id/events            SSE ServiceEvent (existing route)
 *
 * Browser auth: the CLI holds the daemon's bearer token (daemon info file,
 * 0600) and mints a single-use code (15 s); the browser opens `/auth?t=<code>`,
 * which sets an HttpOnly, SameSite=Strict session cookie and redirects.
 * Cookie-authenticated requests are limited to the explorer routes above,
 * and state-changing ones must carry a same-origin `Origin`.
 */
import type { HealthSummary } from '../health.js';
import type { CanvasOverlay } from '../canvas-links.js';
import type { CanvasRouteTargetKind } from './router.js';

/** Explorer routes (templates; `:id` = project id). Additive to SERVICE_ROUTES. */
export const EXPLORER_ROUTES = {
  auth: '/auth',
  authCode: '/api/auth/code',
  session: '/api/session',
  removeProject: '/api/projects/:id',
  canvas: '/api/projects/:id/canvas',
  health: '/api/projects/:id/health',
  healthSummary: '/api/projects/:id/health/summary',
  healthReport: '/api/projects/:id/health/report',
} as const;

/** Default daemon port, so explorer links stay stable across restarts (falls back to ephemeral when busy). */
export const DEFAULT_EXPLORER_PORT = 4280;
/** Override the preferred daemon port (`0` = always ephemeral). */
export const DAEMON_PORT_ENV = 'FLOWLENS_DAEMON_PORT';

/** Session cookie name; the daemon port is appended because cookies are not port-isolated (RFC 6265 §8.5). */
export const SESSION_COOKIE_PREFIX = 'flowlens_session_';
/**
 * Sign-in code lifetime when the CLI opens the browser itself (Phase 12
 * review M2). The code never appears in the browser's argv: the CLI writes
 * a 0600 launch file (`$FLOWLENS_HOME/run/open-<random>.html`) that
 * redirects to `/auth?t=…`, opens that file and removes it after
 * `LAUNCH_FILE_TTL_MS` (the approach Jupyter uses).
 */
export const AUTH_CODE_TTL_MS = 15_000;
/** `--no-open`: the link is printed for the user to paste, so it lives longer (and is shown in the terminal). */
export const AUTH_CODE_MANUAL_TTL_MS = 120_000;
/** Upper bound the daemon accepts for `AuthCodeRequest.ttl_ms`. */
export const AUTH_CODE_MAX_TTL_MS = AUTH_CODE_MANUAL_TTL_MS;
export const LAUNCH_FILE_TTL_MS = 30_000;
/** Directory (under `$FLOWLENS_HOME`) for launch files. */
export const LAUNCH_FILE_DIR = 'run';
export const SESSION_TTL_MS = 12 * 60 * 60_000;

/* ---------------- auth ---------------- */

export interface AuthCodeRequest {
  /** Hash route to open after sign-in, e.g. `#/p/<id>/health` (validated). */
  redirect?: string;
  /** Code lifetime (default `AUTH_CODE_TTL_MS`, clamped to 1 s … `AUTH_CODE_MAX_TTL_MS`). */
  ttl_ms?: number;
}

export interface AuthCodeResponse {
  ok: true;
  code: string;
  /** `http://127.0.0.1:<port>/auth?t=<code>` — open this in the browser. */
  url: string;
  expires_in_ms: number;
}

export interface SessionResponse {
  ok: true;
  via: 'cookie' | 'bearer';
  version: string;
}

/* ---------------- health ---------------- */

/** Home card payload: the engine's summary plus the graph revision it was computed at. */
export interface ExplorerHealthSummary extends HealthSummary {
  /** Daemon graph revision (bumps on every graph write). */
  revision: number;
  /** True when served from cache. */
  cached: boolean;
}

export type HealthReportFormat = 'html' | 'md';

/* ---------------- UI routing + tabs ---------------- */

/** Sub-view of a project tab; Health is the default. */
export type ProjectView = 'health' | 'map';

/** A tab is Home or a project id. */
export type ExplorerTabId = 'home' | string;

/** What the hash says (see `src/canvas/router/explorer-route.ts`). */
export type ExplorerRoute =
  | { tab: 'home' }
  | {
      tab: 'project';
      /** Absent for legacy `#/entity/…` links: the UI maps them to the active (or only) project. */
      projectId?: string;
      view: ProjectView;
      target?: { kind: CanvasRouteTargetKind; identifier: string };
      overlay?: CanvasOverlay;
    };

/** Persisted tab bar state (localStorage, best effort). */
export interface PersistedTabs {
  version: 1;
  open: string[];
}

export const TABS_STORAGE_KEY = 'flowlens.explorer.tabs';

/* ---------------- contributor dev host (`flowlens canvas --dev`) ---------------- */

/**
 * Vite middleware (HMR) on its own port; `/api/*` and `/auth` are proxied
 * to the daemon so the SPA, cookies and SSE behave exactly as in production.
 */
export interface DevHostOptions {
  /** Daemon port on 127.0.0.1. */
  daemonPort: number;
  /** Dev host port (0 = any free port). Always binds 127.0.0.1. */
  port: number;
}

export interface DevHost {
  /** e.g. `http://127.0.0.1:5173` (no trailing slash). */
  origin: string;
  port: number;
  close(): Promise<void>;
}
