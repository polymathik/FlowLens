/**
 * HTTP route registrations in Express, Fastify, Koa (router), Hono, Elysia,
 * Polka & co.: `app.get('/x', handler)`, `router.post('/x', mw, handler)`,
 * `fastify.route({ method, url, handler })`.
 *
 * The extractors keep no relation for a module-scope registration and drop
 * the path string, so this reads the text of files that import a known
 * framework (or declare a router), then resolves the handler through the
 * graph (`handler.ts`). Receivers named like HTTP clients are ignored.
 */
import type { EntryPoint } from '../../contracts/flow.js';
import { lineAt, matchBracket, splitArgs, stringLiteral, trimSegment, type Segment } from '../source.js';
import { resolveHandler } from '../handler.js';
import { collectMounts, joinPath, prefixesFor, type Mounts } from './http-prefix.js';
import { makeEntry, type DetectContext, type SourceFile } from './types.js';

const VERBS = 'get|post|put|patch|delete|head|options|all';
const REGISTRATION = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*\\.\\s*(${VERBS})\\s*\\(`, 'g');
const ROUTE_OBJECT = /\b([A-Za-z_$][\w$]*)\s*\.\s*route\s*\(\s*\{/g;
const MARKER = /(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"](express|fastify|koa|@koa\/router|koa-router|@hono\/[\w-]+|hono|elysia|polka|restify|itty-router|h3|@fastify\/[\w-]+)(?:\/[^'"]*)?['"]/;
const ROUTER_DECL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:await\s+)?(?:new\s+)?(?:express\.Router|Router|OpenAPIHono|Hono|Elysia|Koa|Polka|polka|express|fastify|Fastify|createRouter)\s*(?:<[^>(]*>)?\s*\(/g;
const CLIENTS = new Set(['axios', 'ky', 'got', 'request', 'superagent', 'fetch', 'http', 'https', '$http', 'client', 'httpClient', 'supertest', 'cy', 'agent']);

interface Registration {
  src: SourceFile;
  recv: string;
  method: string;
  path: string;
  line: number;
  handler: Segment;
  middleware: number;
  framework: string;
}

function routerVars(src: SourceFile): Set<string> {
  return new Set([...src.text.matchAll(ROUTER_DECL)].map((m) => m[1]));
}

function frameworkOf(src: SourceFile): string | null {
  return src.text.match(MARKER)?.[1] ?? null;
}

const looksLikePath = (p: string): boolean => p.startsWith('/') || p === '*' || p === '';

function callRegistrations(src: SourceFile, framework: string | null, routers: Set<string>): Registration[] {
  const out: Registration[] = [];
  for (const m of src.text.matchAll(REGISTRATION)) {
    const recv = m[1];
    if (CLIENTS.has(recv)) continue;
    if (!framework && !routers.has(recv)) continue;
    const open = (m.index as number) + m[0].length - 1;
    const close = matchBracket(src.text, open);
    if (close < 0) continue;
    const args = splitArgs(src.text, open, close).map((a) => trimSegment(src.text, a));
    if (args.length < 2) continue;
    const path = stringLiteral(src.text.slice(args[0].start, args[0].end));
    if (path === null || !looksLikePath(path)) continue;
    const last = args[args.length - 1];
    if (/^\{/.test(src.text.slice(last.start, last.end))) continue; // options object last: a client call
    out.push({ src, recv, method: m[2].toUpperCase(), path, line: lineAt(src.starts, m.index as number), handler: last, middleware: args.length - 2, framework: framework ?? 'router' });
  }
  return out;
}

/** Fastify-style `x.route({ method: 'GET', url: '/p', handler })`. */
function objectRegistrations(src: SourceFile, framework: string | null): Registration[] {
  const out: Registration[] = [];
  for (const m of src.text.matchAll(ROUTE_OBJECT)) {
    const open = (m.index as number) + m[0].length - 1;
    const close = matchBracket(src.text, open);
    if (close < 0 || !framework) continue;
    const props = splitArgs(src.text, open, close).map((a) => trimSegment(src.text, a));
    const prop = (name: string): Segment | null => {
      for (const p of props) {
        const mm = src.text.slice(p.start, p.end).match(new RegExp(`^${name}\\s*:\\s*`));
        if (mm) return { start: p.start + mm[0].length, end: p.end };
        if (src.text.slice(p.start, p.end) === name) return p; // shorthand `handler,`
      }
      return null;
    };
    const url = prop('url') ?? prop('path');
    const method = prop('method');
    const handler = prop('handler');
    const path = url ? stringLiteral(src.text.slice(url.start, url.end)) : null;
    if (!handler || path === null) continue;
    const verbs = method ? [...src.text.slice(method.start, method.end).matchAll(/['"`](\w+)['"`]/g)].map((v) => v[1].toUpperCase()) : ['ALL'];
    for (const v of verbs.length > 0 ? verbs : ['ALL']) {
      out.push({ src, recv: m[1], method: v, path, line: lineAt(src.starts, m.index as number), handler, middleware: 0, framework });
    }
  }
  return out;
}

export function detectHttpRoutes(ctx: DetectContext): EntryPoint[] {
  const sources: SourceFile[] = [];
  for (const f of ctx.scriptFiles()) {
    const src = ctx.source(f.file);
    if (src && /\.(?:get|post|put|patch|delete|head|options|all|route)\s*\(/.test(src.text)) sources.push(src);
  }
  const routers = new Map(sources.map((s) => [s.file, routerVars(s)]));
  const regs: Registration[] = [];
  for (const src of sources) {
    const fw = frameworkOf(src);
    const rv = routers.get(src.file) as Set<string>;
    regs.push(...callRegistrations(src, fw, rv), ...objectRegistrations(src, fw));
  }
  if (regs.length === 0) return [];
  const mounts: Mounts = collectMounts(ctx.graph, sources, (f) => ctx.source(f), routers);

  const out: EntryPoint[] = [];
  for (const r of regs) {
    const target = resolveHandler(ctx.args(r.src), r.handler, r.line);
    if (!target) continue;
    for (const prefix of prefixesFor(mounts, r.src.file, r.recv)) {
      const full = prefix ? joinPath(prefix, r.path) : r.path || '/';
      const mw = r.middleware > 0 ? `, ${r.middleware} middleware` : '';
      out.push(makeEntry({
        entity: target.entity,
        file: r.src.file,
        line: r.line,
        kind: 'http_route',
        label: `${r.method} ${full}`,
        confidence: Math.min(target.confidence, r.framework === 'router' ? 0.75 : 0.95),
        evidence: `${r.framework} ${r.recv}.${r.method.toLowerCase()}() registration${prefix ? ` mounted at ${prefix}` : ''}${mw}; ${target.how}`,
        span: target.span,
      }));
    }
  }
  return out;
}
