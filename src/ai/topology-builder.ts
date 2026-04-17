/**
 * Build an `AIInferenceRequest` from the graph. Privacy-critical: this is
 * the function responsible for guaranteeing that the outgoing payload
 * contains ONLY topology — file paths and aggregate counts, never source
 * code or symbol bodies.
 *
 * Clustering strategy: group files by their top-level directory
 * (e.g. "src", "test", "scripts"). Each cluster then lists its member
 * file paths and counts edges internal vs external to the cluster.
 * Shared path prefixes are computed as the longest common prefix across
 * all member paths, split on "/".
 */
import type { Entity } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';
import type { AIInferenceRequest } from '../contracts/ai-integration.js';

export function buildTopology(
  entities: Entity[],
  relations: Relation[],
): AIInferenceRequest {
  const fileEntities = entities.filter((e) => e.kind === 'file');

  // Cluster each file entity by top-level directory
  const clustersByDir = new Map<string, Entity[]>();
  for (const file of fileEntities) {
    const dir = topLevelDir(file.file);
    if (!clustersByDir.has(dir)) clustersByDir.set(dir, []);
    clustersByDir.get(dir)!.push(file);
  }

  // Build entity-id → cluster-dir lookup for edge classification
  const entityToDir = new Map<string, string>();
  for (const entity of entities) {
    entityToDir.set(entity.id, topLevelDir(entity.file));
  }

  // Aggregate edges per cluster
  const internalCounts = new Map<string, number>();
  const externalCounts = new Map<string, number>();
  for (const rel of relations) {
    const fromDir = entityToDir.get(rel.from);
    const toDir = entityToDir.get(rel.to);
    if (fromDir === undefined || toDir === undefined) continue;
    if (fromDir === toDir) {
      internalCounts.set(fromDir, (internalCounts.get(fromDir) ?? 0) + 1);
    } else {
      externalCounts.set(fromDir, (externalCounts.get(fromDir) ?? 0) + 1);
      externalCounts.set(toDir, (externalCounts.get(toDir) ?? 0) + 1);
    }
  }

  // Language counts from all entities (file-kind only carries a language)
  const languages: Record<string, number> = {};
  for (const file of fileEntities) {
    languages[file.language] = (languages[file.language] ?? 0) + 1;
  }

  const clusters = [...clustersByDir.entries()].map(([dir, files]) => {
    const paths = files.map((f) => f.file);
    return {
      files: paths,
      internal_edge_count: internalCounts.get(dir) ?? 0,
      external_edge_count: externalCounts.get(dir) ?? 0,
      common_prefixes: commonPrefixes(paths),
    };
  });

  return {
    topology: {
      clusters,
      total_entities: entities.length,
      total_relations: relations.length,
      languages,
    },
  };
}

function topLevelDir(filePath: string): string {
  const slash = filePath.indexOf('/');
  return slash === -1 ? '' : filePath.slice(0, slash);
}

/**
 * Compute common prefixes of a set of paths. For single-cluster paths that
 * share "src/auth/", the output is ["src/", "src/auth/"]. This gives the
 * model progressive levels of specificity to choose from.
 */
function commonPrefixes(paths: string[]): string[] {
  if (paths.length === 0) return [];
  const parts = paths[0].split('/');
  const prefixes: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    const candidate = parts.slice(0, i).join('/') + '/';
    if (paths.every((p) => p.startsWith(candidate))) {
      prefixes.push(candidate);
    } else {
      break;
    }
  }
  return prefixes;
}
