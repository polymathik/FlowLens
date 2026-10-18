/**
 * Route prefixes from mounts: `app.use('/api', apiRouter)`,
 * `app.route('/v1', v1)` (Hono), `app.register(plugin, { prefix: '/x' })`
 * (Fastify) and `new Hono().basePath('/api')`. Resolved within a file and one
 * import away (named exports, or a default import of a router file), nested up
 * to a few levels. Anything else keeps the plain path (documented limitation).
 */
import type { FlowGraph } from '../graph.js';
import { resolveName } from '../resolve-name.js';
import { matchBracket, splitArgs, stringLiteral, trimSegment } from '../source.js';
import { baseOf, type SourceFile } from './types.js';

export interface MountEdge {
  fromFile: string;
  fromRecv: string;
  prefix: string;
  toFile: string;
  toRecv: string;
}

export interface Mounts {
  edges: MountEdge[];
  /** `file::receiver` → own base path (`basePath('/api')`). */
  base: Map<string, string>;
}

const key = (file: string, recv: string): string => `${file}::${recv}`;

export const joinPath = (...parts: string[]): string => {
  const joined = '/' + parts.map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
  return joined === '/' ? '/' : joined.replace(/\/{2,}/g, '/');
};

const MOUNT_CALL = /\b([A-Za-z_$][\w$]*)\s*\.\s*(use|route|register)\s*\(/g;
const BASE_PATH = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=[^;]*?\.basePath\(\s*(['"`])([^'"`]*)\2/g;

/** The file a default-imported router comes from (`import users from './routes/users.js'`). */
function defaultImportFile(graph: FlowGraph, src: SourceFile, name: string): string | null {
  const m = src.text.match(new RegExp(`import\\s+${name}\\s*(?:,[^;]*?)?from\\s*['"]([^'"]+)['"]`));
  if (!m) return null;
  const stem = baseOf(m[1]).replace(/\.[cm]?[jt]sx?$/, '');
  const hit = graph.importedFiles(src.file, 1).find((f) => baseOf(f).replace(/\.[cm]?[jt]sx?$/, '') === stem);
  return hit ?? null;
}

/** Router variable a default-exported router file registers on (`export default router`). */
function defaultExportRecv(src: SourceFile | null): string | null {
  return src?.text.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/)?.[1] ?? null;
}

export function collectMounts(
  graph: FlowGraph,
  files: SourceFile[],
  sourceOf: (file: string) => SourceFile | null,
  routers: Map<string, Set<string>>,
): Mounts {
  const edges: MountEdge[] = [];
  const base = new Map<string, string>();
  for (const src of files) {
    for (const m of src.text.matchAll(BASE_PATH)) base.set(key(src.file, m[1]), m[3]);
    for (const m of src.text.matchAll(MOUNT_CALL)) {
      const open = (m.index as number) + m[0].length - 1;
      const close = matchBracket(src.text, open);
      if (close < 0) continue;
      const recv = m[1];
      const args = splitArgs(src.text, open, close).map((s) => trimSegment(src.text, s));
      const texts = args.map((a) => src.text.slice(a.start, a.end));
      let prefix: string | null = null;
      let target: string | null = null;
      if (m[2] === 'register') {
        target = texts[0] ?? null;
        const opt = texts.find((t) => t.startsWith('{'));
        prefix = opt?.match(/prefix\s*:\s*(['"`])([^'"`]*)\1/)?.[2] ?? null;
      } else {
        prefix = texts[0] !== undefined ? stringLiteral(texts[0]) : null;
        target = texts[1] ?? null;
      }
      if (prefix === null || !target || !/^[A-Za-z_$][\w$]*$/.test(target)) continue;
      const decl = resolveName(graph, { file: src.file, name: target, kinds: new Set(['variable', 'function']) })[0]?.entity;
      if (decl && decl.file !== src.file) {
        edges.push({ fromFile: src.file, fromRecv: recv, prefix, toFile: decl.file, toRecv: decl.name });
        continue;
      }
      if (decl) {
        edges.push({ fromFile: src.file, fromRecv: recv, prefix, toFile: src.file, toRecv: target });
        continue;
      }
      const viaDefault = defaultImportFile(graph, src, target);
      const recvInTarget = viaDefault ? defaultExportRecv(sourceOf(viaDefault)) : null;
      if (viaDefault && recvInTarget && routers.get(viaDefault)?.has(recvInTarget)) {
        edges.push({ fromFile: src.file, fromRecv: recv, prefix, toFile: viaDefault, toRecv: recvInTarget });
      }
    }
  }
  return { edges, base };
}

/** Full prefixes of routes registered on `recv` in `file` (`['']` when it is never mounted). */
export function prefixesFor(mounts: Mounts, file: string, recv: string, depth = 0): string[] {
  const own = mounts.base.get(key(file, recv)) ?? '';
  const parents = mounts.edges.filter((e) => e.toFile === file && e.toRecv === recv && !(e.fromFile === file && e.fromRecv === recv));
  if (parents.length === 0 || depth >= 4) return [own ? joinPath(own) : ''];
  const out = new Set<string>();
  for (const p of parents) {
    for (const outer of prefixesFor(mounts, p.fromFile, p.fromRecv, depth + 1)) out.add(joinPath(outer, p.prefix, own));
    if (out.size >= 4) break;
  }
  return [...out].sort();
}
