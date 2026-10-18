import type { Relation } from '../contracts/relations.js';
import type { PendingRelation } from '../contracts/symbols.js';

/** A relation waiting for pass-2 resolution (`to === ''` with a symbolic target). */
export function isPending(r: Relation): r is PendingRelation {
  return r.to === '' && typeof r.target_name === 'string';
}
