/**
 * Decorator-registered entry points (NestJS): `@Controller('cats')` +
 * `@Get(':id')` → `GET /cats/:id`; `@OnEvent('x')` / `@EventPattern` /
 * `@MessagePattern` / `@Cron` → event handlers; `@Query()` / `@Mutation()`
 * of `@nestjs/graphql` resolvers. The graph has the decorator entities and
 * their method; the argument text (the path) comes from the decorator line.
 */
import type { Entity } from '../../contracts/entities.js';
import type { EntryPoint } from '../../contracts/flow.js';
import { joinPath } from './http-prefix.js';
import { makeEntry, type DetectContext } from './types.js';

const HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'All']);
const EVENT_DECORATORS = new Set(['OnEvent', 'EventPattern', 'MessagePattern', 'Cron', 'Interval', 'Timeout', 'Process']);
const GRAPHQL_DECORATORS = new Set(['Query', 'Mutation', 'Subscription']);

function decoratorArg(line: string, name: string): string | null {
  const m = line.match(new RegExp(`@${name}\\s*\\(\\s*(?:\\{[^}]*?(?:path|name)\\s*:\\s*)?(['"\`])([^'"\`]*)\\1`));
  return m ? m[2] : null;
}

function lineText(text: string, starts: number[], line: number): string {
  const start = starts[line - 1] ?? 0;
  const end = starts[line] ?? text.length;
  return text.slice(start, end);
}

export function detectDecoratorEntries(ctx: DetectContext): EntryPoint[] {
  const { graph } = ctx;
  const out: EntryPoint[] = [];
  const files = new Set<string>();
  for (const e of graph.entities) if (e.kind === 'decorator') files.add(e.file);

  for (const file of [...files].sort()) {
    if (graph.isTestFile(file)) continue;
    const src = ctx.source(file);
    if (!src || !/@nestjs\//.test(src.text)) continue;
    const graphql = src.text.includes('@nestjs/graphql');
    const decorators = (graph.byFile.get(file) ?? []).filter((e) => e.kind === 'decorator');
    const classPrefix = new Map<string, string>();
    for (const d of decorators) {
      if (d.name !== 'Controller') continue;
      classPrefix.set(d.qualified_name.slice(0, -'.@Controller'.length), decoratorArg(lineText(src.text, src.starts, d.location.line_start), 'Controller') ?? '');
    }
    for (const d of decorators) {
      const targetQn = d.qualified_name.slice(0, d.qualified_name.length - d.name.length - 2); // strip '.@Name'
      const target: Entity | undefined = graph.byQn.get(targetQn);
      if (!target || target.kind !== 'method') continue;
      const cls = targetQn.slice(0, targetQn.lastIndexOf('.'));
      const text = lineText(src.text, src.starts, d.location.line_start);
      const line = d.location.line_start;
      if (HTTP_DECORATORS.has(d.name) && classPrefix.has(cls)) {
        const sub = decoratorArg(text, d.name) ?? '';
        out.push(makeEntry({
          entity: target, line, kind: 'http_route',
          label: `${d.name.toUpperCase()} ${joinPath(classPrefix.get(cls) as string, sub)}`,
          confidence: 0.95, evidence: `NestJS @${d.name}() on ${target.name} in a @Controller class`,
        }));
      } else if (EVENT_DECORATORS.has(d.name)) {
        const arg = decoratorArg(text, d.name);
        out.push(makeEntry({
          entity: target, line, kind: 'event_handler',
          label: `${d.name === 'Cron' ? 'cron' : 'on'} ${arg ?? d.name}`,
          confidence: 0.85, evidence: `NestJS @${d.name}() on ${target.name}`,
        }));
      } else if (graphql && GRAPHQL_DECORATORS.has(d.name)) {
        out.push(makeEntry({
          entity: target, line, kind: 'http_route',
          label: `GraphQL ${d.name} ${target.name}`,
          confidence: 0.9, evidence: `NestJS GraphQL @${d.name}() resolver ${target.name}`,
        }));
      }
    }
  }
  return out;
}
