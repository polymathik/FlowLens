/**
 * UI roots (what a bootstrap file mounts) and event-listener registrations.
 *
 *  - React `createRoot(el).render(<App />)`, `hydrateRoot(el, <App />)`,
 *    `ReactDOM.render(<App />, el)`; Vue `createApp(App)`; Svelte `mount(App, …)` /
 *    `new App({ target })`; Angular `bootstrapApplication(App)`.
 *  - `x.on('event', handler)` / `addEventListener('click', handler)` at module
 *    scope, or on well-known process/window/Electron emitters anywhere.
 */
import type { EntryPoint } from '../../contracts/flow.js';
import { resolveHandler } from '../handler.js';
import { resolveName } from '../resolve-name.js';
import { lineAt, matchBracket, splitArgs, stringLiteral, trimSegment } from '../source.js';
import { makeEntry, type DetectContext, type SourceFile } from './types.js';

const ROOTS: Array<{ re: RegExp; fw: string }> = [
  { re: /\.render\(\s*(?:<React\.StrictMode>\s*)?<([A-Z][\w$]*)/g, fw: 'React render()' },
  { re: /hydrateRoot\([^,()]+,\s*(?:<React\.StrictMode>\s*)?<([A-Z][\w$]*)/g, fw: 'React hydrateRoot()' },
  { re: /\brender\(\s*\(\)\s*=>\s*<([A-Z][\w$]*)/g, fw: 'Solid render()' },
  { re: /\bcreate(?:SSR)?App\(\s*([A-Z][\w$]*)\s*[,)]/g, fw: 'Vue createApp()' },
  { re: /\b(?:mount|hydrate)\(\s*([A-Z][\w$]*)\s*,/g, fw: 'Svelte mount()' },
  { re: /\bnew\s+([A-Z][\w$]*)\(\s*\{\s*target\b/g, fw: 'Svelte new App({ target })' },
  { re: /\bbootstrapApplication\(\s*([A-Z][\w$]*)/g, fw: 'Angular bootstrapApplication()' },
];
const LISTENER = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\.\s*(on|once|addEventListener|addListener|handle)\s*\(/g;
const WELL_KNOWN = /^(?:process|window|document|self|globalThis|ipcMain|ipcRenderer|chrome\.\w+|browser\.\w+|app|server|client|bot)$/;
const MAX_LISTENERS_PER_FILE = 25;

function uiRoots(ctx: DetectContext, src: SourceFile, out: EntryPoint[]): void {
  for (const { re, fw } of ROOTS) {
    for (const m of src.text.matchAll(re)) {
      const comp = resolveName(ctx.graph, { file: src.file, name: m[1], kinds: new Set(['component', 'function', 'class']) })[0]?.entity;
      if (!comp) continue;
      out.push(makeEntry({
        entity: comp, file: src.file, line: lineAt(src.starts, m.index as number), kind: 'ui_component_root', label: `ui: <${comp.name}>`,
        confidence: 0.9, evidence: `${fw} mounts ${comp.name} in ${src.file}`,
      }));
    }
  }
}

function listeners(ctx: DetectContext, src: SourceFile, out: EntryPoint[]): void {
  let n = 0;
  for (const m of src.text.matchAll(LISTENER)) {
    if (n >= MAX_LISTENERS_PER_FILE) return;
    const open = (m.index as number) + m[0].length - 1;
    const close = matchBracket(src.text, open);
    if (close < 0) continue;
    const args = splitArgs(src.text, open, close).map((a) => trimSegment(src.text, a));
    const event = args[0] ? stringLiteral(src.text.slice(args[0].start, args[0].end)) : null;
    if (event === null || args.length < 2 || (m[2] === 'handle' && m[1] !== 'ipcMain')) continue;
    const line = lineAt(src.starts, m.index as number);
    const atModuleScope = !ctx.graph.enclosing(src.file, line);
    if (!atModuleScope && !WELL_KNOWN.test(m[1])) continue;
    const target = resolveHandler(ctx.args(src), args[args.length - 1], line);
    if (!target) continue;
    n++;
    out.push(makeEntry({
      entity: target.entity, file: src.file, line, kind: 'event_handler', label: `${m[2] === 'handle' ? 'ipc' : 'on'} ${m[1]} '${event}'`,
      confidence: Math.min(target.confidence, 0.7), evidence: `${m[1]}.${m[2]}('${event}') registration; ${target.how}`, span: target.span,
    }));
  }
}

export function detectUiAndEvents(ctx: DetectContext): EntryPoint[] {
  const out: EntryPoint[] = [];
  for (const f of ctx.scriptFiles()) {
    const src = ctx.source(f.file);
    if (!src) continue;
    uiRoots(ctx, src, out);
    if (/\.(?:on|once|addEventListener|addListener|handle)\s*\(\s*['"`]/.test(src.text)) listeners(ctx, src, out);
  }
  return out;
}
