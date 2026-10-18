/**
 * Pass 2 driver: resolve pending relations through the symbol table.
 *
 * - resolved   → an ordinary edge (`resolution: 'resolved'`); a `call` whose
 *                target turns out to be a class becomes `create`.
 * - unresolved / ambiguous → kept as explicit records (`to: ''`) unless the
 *                pending relation is optional, in which case it is dropped.
 * - external   → dropped (the reference leaves the project), counted.
 */
import type { Relation } from '../../contracts/relations.js';
import type { PendingRelation, ResolutionResult, ResolutionStats } from '../../contracts/symbols.js';
import { generateRelationId } from '../../utils/id.js';
import type { ProjectSymbolTable } from './symbol-table.js';
import { targetKinds } from './target-kinds.js';

export function emptyStats(): ResolutionStats {
  return { resolved: 0, unresolved: 0, ambiguous: 0, external: 0, optional_dropped: 0 };
}

export function resolvePendingRelations(
  table: ProjectSymbolTable,
  pending: PendingRelation[],
  stats: ResolutionStats = emptyStats(),
): ResolutionResult {
  const relations: Relation[] = [];
  const unresolved: Relation[] = [];

  for (const p of pending) {
    if (p.final) {
      stats.unresolved++;
      unresolved.push({ ...stripPending(p), resolution: 'unresolved' });
      continue;
    }
    const toFile = p.resolve_to === 'file';
    const kinds = toFile ? undefined : (p.kinds ?? targetKinds(p.type));
    const outcome = table.resolve(p.location.file, p.target_name, kinds);
    const base = stripPending(p);

    if (outcome.status === 'resolved') {
      const target = table.entity(outcome.id);
      if (!target) { stats.unresolved++; continue; }
      const to = toFile ? table.fileEntityId(target.file) : target.id;
      const redundant = toFile && (target.file === p.location.file || target.file === p.meta?.via);
      if (!to || redundant) { stats.optional_dropped++; continue; }
      const type = p.type === 'call' && target.kind === 'class' ? 'create' : p.type;
      stats.resolved++;
      relations.push({
        ...base,
        type,
        to,
        id: generateRelationId(p.from, to, type, p.location.file, p.location.line),
        resolution: 'resolved',
      });
    } else if (outcome.status === 'external') {
      stats.external++;
    } else if (p.optional) {
      stats.optional_dropped++;
    } else if (outcome.status === 'ambiguous') {
      stats.ambiguous++;
      unresolved.push({
        ...base,
        resolution: 'ambiguous',
        meta: { ...base.meta, candidates: outcome.candidates },
      });
    } else {
      stats.unresolved++;
      unresolved.push({ ...base, resolution: 'unresolved' });
    }
  }
  return { relations, unresolved, stats };
}

function stripPending(p: PendingRelation): Relation {
  const { optional: _o, resolve_to: _r, final: _f, kinds: _k, ...rest } = p;
  return { ...rest, to: '' };
}
