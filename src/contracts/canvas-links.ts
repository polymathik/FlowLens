/**
 * Canvas deep-link URL contract.
 *
 * MCP tool responses and health findings embed a `canvas_url` pointing to
 * the relevant view in the explorer the FlowLens daemon serves, so an AI
 * assistant can hand a clickable link back to the developer. URLs use hash
 * routing (see `src/canvas/router/explorer-route.ts`):
 *
 *   http://127.0.0.1:4280/#/p/<projectId>/map/entity/UserService?overlay=complexity
 *
 * Base URL resolution (Phase 12): explicit `baseUrl` → `FLOWLENS_CANVAS_URL`
 * env var → `http://127.0.0.1:<daemonPort>` where the port is the running
 * daemon's (when the caller knows it), else `$FLOWLENS_DAEMON_PORT`, else
 * 4280. The explorer needs a browser session: a link opened without one
 * shows a "run `flowlens canvas`" page.
 */
import { DAEMON_PORT_ENV, DEFAULT_EXPLORER_PORT } from './canvas/explorer.js';

export type CanvasLinkKind = 'entity' | 'module' | 'file' | 'flow';

export type CanvasOverlay =
  | 'complexity'
  | 'churn'
  | 'hotspot'
  | 'cycles'
  | 'violations'
  | 'diff';

export interface CanvasLinkOptions {
  kind: CanvasLinkKind;
  /** For entity: qualified_name or ID. For module/file: path. */
  identifier: string;
  overlay?: CanvasOverlay;
  /** Optional override of the canvas base URL. Defaults to env / localhost. */
  baseUrl?: string;
  /**
   * Project id (multi-project explorer, Phase 11). When set the link is
   * `#/p/<projectId>/<kind>/<id>` and opens that project's map tab;
   * without it the explorer maps the link to the active (or only) project.
   */
  projectId?: string;
  /** Port of the running daemon, when the caller knows it (Phase 12). */
  daemonPort?: number;
  /**
   * Extra query parameters of the hash (Flow view, M6a): `depth`, and for an
   * inline-handler entry `span=<first>-<last>`. Appended after `overlay`.
   */
  params?: Record<string, string | number>;
}

/** Explorer host; the daemon only listens on loopback. */
export const CANVAS_LINK_HOST = '127.0.0.1';

function envPort(): number | undefined {
  const raw = typeof process !== 'undefined' ? process.env?.[DAEMON_PORT_ENV] : undefined;
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 && n <= 65535 ? n : undefined;
}

/** Base URL of the explorer (no trailing slash), per the resolution order above. */
export function resolveCanvasBaseUrl(override?: string, daemonPort?: number): string {
  if (override) return override;
  if (typeof process !== 'undefined' && process.env?.FLOWLENS_CANVAS_URL) {
    return process.env.FLOWLENS_CANVAS_URL;
  }
  return `http://${CANVAS_LINK_HOST}:${daemonPort ?? envPort() ?? DEFAULT_EXPLORER_PORT}`;
}

/**
 * Build a canvas deep-link URL for a given target. With `projectId` the link
 * is `#/p/<id>/map/<kind>/<identifier>`; without it, the legacy
 * `#/<kind>/<identifier>` that the explorer maps to the active project. The identifier is
 * percent-encoded so path-like qualified names (e.g. `src/foo/bar.ts::Foo`)
 * survive the URL fragment. Overlays become `?overlay=<name>` on the hash.
 * The Flow view link is `#/p/<id>/map/flow/<entityId>?depth=N` (kind `flow`).
 */
export function buildCanvasUrl(opts: CanvasLinkOptions): string {
  const base = resolveCanvasBaseUrl(opts.baseUrl, opts.daemonPort).replace(/\/+$/, '');
  const encoded = encodeURIComponent(opts.identifier);
  const query = [
    ...(opts.overlay ? [`overlay=${opts.overlay}`] : []),
    ...Object.entries(opts.params ?? {}).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`),
  ];
  const overlaySuffix = query.length > 0 ? `?${query.join('&')}` : '';
  const project = opts.projectId ? `p/${encodeURIComponent(opts.projectId)}/map/` : '';
  return `${base}/#/${project}${opts.kind}/${encoded}${overlaySuffix}`;
}
