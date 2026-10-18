/**
 * File-system routing frameworks: SvelteKit (`+page.svelte`, `+server.ts`,
 * `+page.ts` load), Next.js (`app/**\/page.tsx`, `route.ts`, `pages/**`,
 * `middleware.ts`), Remix (`app/routes/**`), Nuxt (`pages/**`, `server/api/**`).
 * Pure path conventions over the graph's file entities; the package.json
 * dependency check only decides the confidence (a bare `pages/` folder is
 * not proof of a framework).
 */
import type { Entity } from '../../contracts/entities.js';
import type { EntryPoint } from '../../contracts/flow.js';
import type { FlowGraph } from '../graph.js';
import { dependsOn } from './package-info.js';
import { baseOf, makeEntry, type DetectContext } from './types.js';

const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const CODE_EXT = '(?:tsx|ts|jsx|js|mjs|cjs)';

/** URL from path segments: route groups `(g)`, parallel slots `@s` and `index` vanish. */
function urlOf(segments: string[]): string {
  const parts = segments.filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@') && s !== 'index');
  return '/' + parts.join('/');
}

function topLevel(graph: FlowGraph, file: string, name: string): Entity | undefined {
  return graph.byQn.get(`${file}/${name}`);
}

function verbExports(graph: FlowGraph, file: string): Entity[] {
  return VERBS.map((v) => topLevel(graph, file, v)).filter((e): e is Entity => !!e && (e.kind === 'function' || e.kind === 'variable'));
}

/** The page component of a code file: `Page`, else the first capitalised exported function. */
function defaultComponent(graph: FlowGraph, file: string): Entity | undefined {
  const fns = (graph.byFile.get(file) ?? []).filter((e) => (e.kind === 'function' || e.kind === 'component' || e.kind === 'class') && e.visibility === 'public' && !e.qualified_name.slice(file.length + 1).includes('.'));
  return fns.find((e) => /^Page$/.test(e.name)) ?? fns.find((e) => /Page$/.test(e.name)) ?? fns.find((e) => /^[A-Z]/.test(e.name)) ?? fns[0];
}

function handlerFn(graph: FlowGraph, file: string): Entity | undefined {
  const fns = (graph.byFile.get(file) ?? []).filter((e) => e.kind === 'function' && !e.qualified_name.slice(file.length + 1).includes('.'));
  return fns.find((e) => e.name === 'handler') ?? fns.find((e) => e.visibility === 'public') ?? fns[0];
}

type Push = (e: Entity, o: { kind: EntryPoint['kind']; label: string; confidence: number; evidence: string }) => void;

function svelteKit(graph: FlowGraph, file: string, push: Push): boolean {
  const m = file.match(/(?:^|\/)routes\/((?:.*\/)?)\+(page|layout|server|error)(\.server)?\.(svelte|ts|js)$/);
  if (!m) return false;
  const url = urlOf(m[1].split('/'));
  const [, , what, , ext] = m;
  const fileEntity = graph.fileEntity.get(file) as Entity;
  if (ext === 'svelte' && (what === 'page' || what === 'layout')) {
    const comp = (graph.byFile.get(file) ?? []).find((e) => e.kind === 'component') ?? fileEntity;
    push(comp, { kind: 'page_route', label: `${what === 'page' ? 'page' : 'layout'} ${url}`, confidence: what === 'page' ? 0.95 : 0.8, evidence: `SvelteKit +${what}.svelte under routes/` });
  } else if (what === 'server') {
    for (const e of verbExports(graph, file)) push(e, { kind: 'http_route', label: `${e.name} ${url}`, confidence: 0.95, evidence: `SvelteKit +server.${ext} exports ${e.name}` });
  } else if (what === 'page' || what === 'layout') {
    const load = topLevel(graph, file, 'load');
    if (load) push(load, { kind: 'page_route', label: `load ${url}`, confidence: 0.9, evidence: `SvelteKit +${what}${m[3] ?? ''}.${ext} load()` });
    const actions = topLevel(graph, file, 'actions');
    if (actions && what === 'page') push(actions, { kind: 'http_route', label: `POST ${url} (form actions)`, confidence: 0.8, evidence: `SvelteKit +page${m[3] ?? ''}.${ext} exports actions` });
  }
  return true;
}

function nextApp(ctx: DetectContext, file: string, push: Push): boolean {
  const m = file.match(new RegExp(`(?:^|/)app/((?:.*/)?)(page|route|layout)\\.${CODE_EXT}$`));
  if (!m || /(?:^|\/)routes\//.test(file)) return false;
  const next = dependsOn(ctx, file, ['next']);
  if (next === false) return false;
  const conf = next === true ? 0.95 : 0.5;
  const url = urlOf(m[1].split('/'));
  const g = ctx.graph;
  if (m[2] === 'route') {
    for (const e of verbExports(g, file)) push(e, { kind: 'http_route', label: `${e.name} ${url}`, confidence: conf, evidence: `Next.js app router route.ts exports ${e.name}` });
  } else {
    const comp = defaultComponent(g, file) ?? (g.fileEntity.get(file) as Entity);
    push(comp, { kind: 'page_route', label: `${m[2]} ${url}`, confidence: m[2] === 'page' ? conf : conf * 0.8, evidence: `Next.js app router ${m[2]}.tsx` });
  }
  return true;
}

function pagesDir(ctx: DetectContext, file: string, push: Push): boolean {
  const m = file.match(new RegExp(`(?:^|/)pages/(.*)\\.(${CODE_EXT.slice(3, -1)}|vue)$`));
  if (!m || /(?:^|\/)app\/routes\//.test(file)) return false;
  const rel = m[1];
  const g = ctx.graph;
  if (/^_(?:app|document|error)$|^(?:404|500)$/.test(rel) || rel.split('/').some((s) => s.startsWith('_'))) return true;
  const vue = m[2] === 'vue';
  const fw = dependsOn(ctx, file, vue ? ['nuxt', '@nuxt/'] : ['next']);
  if (fw === false) return false;
  const conf = fw === true ? 0.95 : 0.45;
  const name = vue ? 'Nuxt' : 'Next.js';
  if (!vue && rel.startsWith('api/')) {
    const e = handlerFn(g, file) ?? (g.fileEntity.get(file) as Entity);
    push(e, { kind: 'http_route', label: `ANY ${urlOf(rel.split('/'))}`, confidence: conf * 0.9, evidence: `${name} pages/api handler` });
    return true;
  }
  const comp = vue ? (g.byFile.get(file) ?? []).find((e) => e.kind === 'component') : defaultComponent(g, file);
  push(comp ?? (g.fileEntity.get(file) as Entity), { kind: 'page_route', label: `page ${urlOf(rel.split('/'))}`, confidence: conf, evidence: `${name} pages/ file` });
  return true;
}

function remix(ctx: DetectContext, file: string, push: Push): boolean {
  const m = file.match(new RegExp(`(?:^|/)app/routes/(.*)\\.${CODE_EXT}$`));
  if (!m) return false;
  const fw = dependsOn(ctx, file, ['@remix-run/', 'react-router', '@react-router/']);
  if (fw === false) return false;
  const conf = fw === true ? 0.9 : 0.4;
  const segs = m[1].split('/').flatMap((part) => part.split('.')).filter((s) => !s.startsWith('_') || s === '_index').map((s) => (s === '_index' ? '' : s.startsWith('$') ? `:${s.slice(1)}` : s.replace(/_$/, '')));
  const url = urlOf(segs);
  const g = ctx.graph;
  const comp = defaultComponent(g, file);
  if (comp) push(comp, { kind: 'page_route', label: `page ${url}`, confidence: conf, evidence: 'Remix/React Router app/routes module' });
  const loader = topLevel(g, file, 'loader');
  if (loader) push(loader, { kind: 'http_route', label: `GET ${url} (loader)`, confidence: conf, evidence: 'Remix route loader()' });
  const action = topLevel(g, file, 'action');
  if (action) push(action, { kind: 'http_route', label: `POST ${url} (action)`, confidence: conf, evidence: 'Remix route action()' });
  return true;
}

function nuxtServer(ctx: DetectContext, file: string, push: Push): boolean {
  const m = file.match(new RegExp(`(?:^|/)server/(api|routes)/(.*?)(?:\\.(get|post|put|patch|delete))?\\.(?:ts|js|mjs)$`));
  if (!m) return false;
  const fw = dependsOn(ctx, file, ['nuxt', 'nitropack', 'h3', '@nuxt/']);
  if (fw === false) return false;
  const url = urlOf([...(m[1] === 'api' ? ['api'] : []), ...m[2].split('/')]);
  const g = ctx.graph;
  push(handlerFn(g, file) ?? (g.fileEntity.get(file) as Entity), {
    kind: 'http_route', label: `${m[3] ? m[3].toUpperCase() : 'ANY'} ${url}`, confidence: fw === true ? 0.9 : 0.5, evidence: `Nuxt/Nitro server/${m[1]} handler`,
  });
  return true;
}

function middleware(ctx: DetectContext, file: string, push: Push): boolean {
  if (!new RegExp(`^(?:src/)?(?:[\\w-]+/)?middleware\\.(?:ts|js)$`).test(file) || dependsOn(ctx, file, ['next']) !== true) return false;
  const e = topLevel(ctx.graph, file, 'middleware') ?? (ctx.graph.fileEntity.get(file) as Entity);
  push(e, { kind: 'event_handler', label: 'middleware (every matched request)', confidence: 0.85, evidence: 'Next.js middleware.ts' });
  return true;
}

function hooks(graph: FlowGraph, file: string, push: Push): boolean {
  if (!/(?:^|\/)hooks\.(?:server|client)\.(?:ts|js)$/.test(file)) return false;
  const handle = topLevel(graph, file, 'handle');
  if (handle) push(handle, { kind: 'event_handler', label: `hook ${baseOf(file).replace(/\.(ts|js)$/, '')} handle`, confidence: 0.8, evidence: 'SvelteKit hooks handle()' });
  return true;
}

export function detectFileRoutes(ctx: DetectContext): EntryPoint[] {
  const out: EntryPoint[] = [];
  for (const f of ctx.graph.sourceFiles()) {
    if (ctx.graph.isTestFile(f.file)) continue;
    const push: Push = (entity, o) => out.push(makeEntry({ entity, file: f.file, line: entity.location.line_start, ...o }));
    svelteKit(ctx.graph, f.file, push) || nextApp(ctx, f.file, push) || remix(ctx, f.file, push)
      || pagesDir(ctx, f.file, push) || nuxtServer(ctx, f.file, push) || middleware(ctx, f.file, push) || hooks(ctx.graph, f.file, push);
  }
  return out;
}
