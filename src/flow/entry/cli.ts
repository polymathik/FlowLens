/**
 * CLI command registrations: commander / cac / sade chains
 * (`program.command('start').option(…).action(fn)`, `new Command('build')…action(…)`)
 * and yargs `.command(name, desc, builder, handler)`. A chain is followed
 * forward from its `.command(` / `new Command(` start; `.addCommand(sub)`
 * names the group (`cli: history build`). Handlers resolve like route handlers.
 */
import type { EntryPoint } from '../../contracts/flow.js';
import { resolveHandler } from '../handler.js';
import { lineAt, matchBracket, skipTrivia, splitArgs, stringLiteral, trimSegment, type Segment } from '../source.js';
import { makeEntry, type DetectContext, type SourceFile } from './types.js';

const START = /(?:\bnew\s+Command\s*\(|\.\s*command\s*\()/g;
const MARKER = /(?:from\s*|require\s*\(\s*)['"](commander|@commander-js\/extra-typings|cac|sade|caporal|yargs|yargs\/yargs)['"]|\bnew\s+Command\s*\(|\byargs\b/;

interface ChainAction {
  name: string;
  handler: Segment;
  offset: number;
  /** Variable holding the command this action belongs to (`const migrate = new Command('migrate')…`). */
  ownerVar?: string;
  parents: string[];
}

const cleanName = (raw: string | null): string => (raw ?? '').trim().split(/\s+/)[0];
const STATEMENT_ADD = /(?:^|[;{}\n])\s*([A-Za-z_$][\w$]*)\s*\.addCommand\(\s*([A-Za-z_$][\w$]*)\s*\)/g;

function declaredVar(text: string, at: number): string | null {
  return text.slice(Math.max(0, at - 80), at).match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*$/)?.[1] ?? null;
}

/** Walk `.a().b().c()` after position `from`; calls `visit(ident, open, close)` for each link. */
function walkChain(text: string, from: number, visit: (ident: string, open: number, close: number) => void): void {
  let pos = from;
  for (;;) {
    const p = skipTrivia(text, pos);
    if (text[p] !== '.') return;
    const m = text.slice(p).match(/^\.\s*([A-Za-z_$][\w$]*)\s*\(/);
    if (!m) return;
    const open = p + m[0].length - 1;
    const close = matchBracket(text, open);
    if (close < 0) return;
    visit(m[1], open, close);
    pos = close + 1;
  }
}

function commanderActions(src: SourceFile): ChainAction[] {
  const { text } = src;
  const seen = new Set<number>();
  const out: ChainAction[] = [];
  const groups = new Map<string, string>(); // variable → command name
  const parentName = new Map<string, string>(); // child variable → parent command name (chain form)
  const parentVar = new Map<string, string>(); // child variable → parent variable (statement form)
  for (const m of text.matchAll(START)) {
    const open = (m.index as number) + m[0].length - 1;
    const close = matchBracket(text, open);
    if (close < 0) continue;
    const first = splitArgs(text, open, close)[0];
    const startName = first ? cleanName(stringLiteral(text.slice(first.start, first.end))) : '';
    let bound = m[0].startsWith('new') ? declaredVar(text, m.index as number) : null;
    if (m[0].startsWith('new') && !bound) {
      // `group.addCommand(new Command('sub')…)`: the sub-command is anonymous, its parent is the receiver
      const receiver = text.slice(Math.max(0, (m.index as number) - 80), m.index as number).match(/([A-Za-z_$][\w$]*)\s*\.\s*addCommand\s*\(\s*$/)?.[1];
      if (receiver) {
        bound = `#inline:${m.index}`;
        parentVar.set(bound, receiver);
      }
    }
    if (bound && startName) groups.set(bound, startName);
    let current = startName;
    walkChain(text, close + 1, (ident, o, end) => {
      const args = splitArgs(text, o, end).map((a) => trimSegment(text, a));
      const arg0 = args[0] ? text.slice(args[0].start, args[0].end) : '';
      if (ident === 'command' && args[0]) current = cleanName(stringLiteral(arg0));
      else if (ident === 'name' && args[0] && !current) current = cleanName(stringLiteral(arg0));
      else if (ident === 'addCommand' && /^[A-Za-z_$][\w$]*$/.test(arg0) && startName) parentName.set(arg0, startName);
      else if (ident === 'action' && args.length > 0 && !seen.has(o)) {
        seen.add(o);
        out.push({ name: current, handler: args[0], offset: o, ownerVar: current === startName && bound ? bound : undefined, parents: [] });
      }
    });
  }
  for (const m of text.matchAll(STATEMENT_ADD)) parentVar.set(m[2], m[1]);
  for (const a of out) {
    let v = a.ownerVar;
    for (let i = 0; v && i < 3; i++) {
      const pv = parentVar.get(v);
      const pn = parentName.get(v) ?? (pv ? groups.get(pv) : undefined);
      if (!pn) break;
      a.parents.unshift(pn);
      v = pv;
    }
  }
  return out;
}

function yargsHandlers(src: SourceFile): ChainAction[] {
  if (!/\byargs\b/.test(src.text)) return [];
  const out: ChainAction[] = [];
  for (const m of src.text.matchAll(/\.\s*command\s*\(/g)) {
    const open = (m.index as number) + m[0].length - 1;
    const close = matchBracket(src.text, open);
    if (close < 0) continue;
    const args = splitArgs(src.text, open, close).map((a) => trimSegment(src.text, a));
    if (args.length < 3) continue;
    const name = cleanName(stringLiteral(src.text.slice(args[0].start, args[0].end))).replace(/^\$0$/, '(default)');
    out.push({ name, handler: args[args.length - 1], offset: open, parents: [] });
  }
  return out;
}

export function detectCliCommands(ctx: DetectContext): EntryPoint[] {
  const out: EntryPoint[] = [];
  for (const f of ctx.scriptFiles()) {
    const src = ctx.source(f.file);
    if (!src || !MARKER.test(src.text)) continue;
    for (const a of [...commanderActions(src), ...yargsHandlers(src)]) {
      const line = lineAt(src.starts, a.offset);
      const target = resolveHandler(ctx.args(src), a.handler, line);
      if (!target) continue;
      const name = [...a.parents, a.name || '(default)'].join(' ');
      out.push(makeEntry({
        entity: target.entity, file: src.file, line, kind: 'cli_command', label: `cli: ${name}`,
        confidence: Math.min(target.confidence, 0.9), evidence: `command-line framework .action()/handler for '${name}'; ${target.how}`, span: target.span,
      }));
    }
  }
  return out;
}
