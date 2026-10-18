/** Relation types shown by default (the structurally meaningful ones). Kept free of React Flow so the explorer shell doesn't load it. */
import type { RelationType } from '../../contracts/relations.js';

export const DEFAULT_VISIBLE_RELATION_TYPES: RelationType[] = ['import', 'call', 'extend', 'implement'];
