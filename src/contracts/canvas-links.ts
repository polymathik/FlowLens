/**
 * Canvas deep-link URL contract.
 *
 * MCP tool responses embed a `canvas_url` pointing to the relevant view in
 * the visual canvas, so that an LLM assistant can hand a clickable link
 * back to the developer after a query. URLs use hash-based routing so the
 * canvas Vite dev server doesn't need path rewriting:
 *
 *   http://localhost:5173/#/entity/UserService?overlay=complexity
 *
 * The base URL is controlled by the `FLOWLENS_CANVAS_URL` env var (so
 * tests and non-default deployments can override). If unset, defaults to
 * `http://localhost:5173` (the canvas default port).
 */

export type CanvasLinkKind = 'entity' | 'module' | 'file';

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
}

const DEFAULT_BASE_URL = 'http://localhost:5173';

function resolveBaseUrl(override?: string): string {
  if (override) return override;
  if (typeof process !== 'undefined' && process.env?.FLOWLENS_CANVAS_URL) {
    return process.env.FLOWLENS_CANVAS_URL;
  }
  return DEFAULT_BASE_URL;
}

/**
 * Build a canvas deep-link URL for a given target. The identifier is
 * percent-encoded so path-like qualified names (e.g. `src/foo/bar.ts::Foo`)
 * survive the URL fragment. Overlays become `?overlay=<name>` on the hash.
 */
export function buildCanvasUrl(opts: CanvasLinkOptions): string {
  const base = resolveBaseUrl(opts.baseUrl).replace(/\/+$/, '');
  const encoded = encodeURIComponent(opts.identifier);
  const overlaySuffix = opts.overlay ? `?overlay=${opts.overlay}` : '';
  const project = opts.projectId ? `p/${encodeURIComponent(opts.projectId)}/` : '';
  return `${base}/#/${project}${opts.kind}/${encoded}${overlaySuffix}`;
}
