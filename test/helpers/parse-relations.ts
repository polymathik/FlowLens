/**
 * Parse one source string through the real parser and render its relations as
 * readable strings, e.g. `call src/a.ts -> src/a.ts/work [module]`.
 * Pending (cross-file) relations render as `-> ?target_name`.
 */
import { AstGrepParser } from '../../src/parser/ast-grep-parser.js';
import type { Entity } from '../../src/contracts/entities.js';
import type { Relation, RelationType } from '../../src/contracts/relations.js';

export interface ParsedSource {
  entities: Entity[];
  relations: Relation[];
  pending: Relation[];
  /** `type from -> to` (+ ` [module]` / ` x3` / ` @receiver`) for direct and pending relations. */
  lines(types?: RelationType[]): string[];
  find(type: RelationType, from: string, to: string): Relation | undefined;
}

export async function parseSource(code: string, file = 'src/a.ts', rootDir = ''): Promise<ParsedSource> {
  const result = await new AstGrepParser(rootDir).parseFile(file, code);
  const byId = new Map(result.entities.map((e) => [e.id, e]));
  const name = (id: string): string => {
    const e = byId.get(id);
    if (!e) return `?${id}`;
    return e.kind === 'file' ? e.file : e.qualified_name.slice(e.file.length + 1);
  };
  const render = (r: Relation): string => {
    const to = r.to ? name(r.to) : `?${r.target_name}`;
    const tags = [r.meta?.owner ? `[${r.meta.owner}]` : '', r.weight > 1 ? `x${r.weight}` : '', r.meta?.receiver ? `@${r.meta.receiver}` : '']
      .filter(Boolean).join(' ');
    return `${r.type} ${name(r.from)} -> ${to}${tags ? ' ' + tags : ''}`;
  };
  const all = [...result.relations, ...(result.pending ?? [])];
  return {
    entities: result.entities,
    relations: result.relations,
    pending: result.pending ?? [],
    lines: (types) => all.filter((r) => !types || types.includes(r.type)).map(render).sort(),
    find: (type, from, to) => all.find((r) => r.type === type && name(r.from) === from && (r.to ? name(r.to) : `?${r.target_name}`) === to),
  };
}
