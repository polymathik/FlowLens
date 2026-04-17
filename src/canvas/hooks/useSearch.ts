/**
 * Hook that filters entities by a search query.
 * Returns up to 10 matching entities, filtering by name or qualified_name.
 */
import { useMemo } from 'react';
import type { Entity } from '../api/graph-client';

export function useSearch(entities: Entity[], query: string): Entity[] {
  return useMemo(() => {
    if (!query || query.length < 2) return [];
    const lower = query.toLowerCase();
    return entities
      .filter(
        (e) =>
          e.name?.toLowerCase().includes(lower) ||
          e.qualified_name?.toLowerCase().includes(lower),
      )
      .slice(0, 10);
  }, [entities, query]);
}
