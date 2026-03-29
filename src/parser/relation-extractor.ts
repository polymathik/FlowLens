/**
 * Relation extraction for TypeScript/JavaScript ASTs.
 *
 * Re-exports the composed `extractRelations` function from the
 * modular `relations/` directory. All relation extraction logic
 * lives in focused modules under `src/parser/relations/`.
 */
export { extractRelations } from './relations/index.js';
