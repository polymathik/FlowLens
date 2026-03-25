import type { Entity } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';
import type { ArchitectureConfig, ArchitectureLayer } from '../contracts/architecture.js';

export function inferArchitecture(
  entities: Entity[],
  relations: Relation[],
): ArchitectureConfig {
  const fileEntities = entities.filter(e => e.kind === 'file');

  // Group by top-level directory
  const groups = new Map<string, Entity[]>();
  for (const entity of fileEntities) {
    const parts = entity.file.split('/');
    const dir = parts.length > 1 ? parts[0] : ''; // root-level files get ''
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(entity);
  }

  // Count only named-directory groups (exclude root-level '' group)
  const namedGroups = [...groups.keys()].filter(k => k !== '');

  // If no meaningful grouping (empty or only root-level files), use single "Application" layer
  if (namedGroups.length === 0) {
    return {
      version: 2,
      inferred_by: 'heuristic',
      inferred_at: new Date().toISOString(),
      layers: [{
        name: 'Application',
        include: { patterns: ['**'] },
      }],
    };
  }

  // Build entity-to-directory lookup for import analysis
  const entityToDir = new Map<string, string>();
  for (const entity of fileEntities) {
    const parts = entity.file.split('/');
    entityToDir.set(entity.id, parts.length > 1 ? parts[0] : '');
  }

  // Analyze import relations to determine layer access patterns
  const importRelations = relations.filter(r => r.type === 'import');
  const accessMap = new Map<string, Set<string>>(); // dir → set of dirs it imports from
  for (const rel of importRelations) {
    const fromDir = entityToDir.get(rel.from);
    const toDir = entityToDir.get(rel.to);
    if (
      fromDir !== undefined &&
      toDir !== undefined &&
      fromDir !== toDir &&
      fromDir !== '' &&
      toDir !== ''
    ) {
      if (!accessMap.has(fromDir)) accessMap.set(fromDir, new Set());
      accessMap.get(fromDir)!.add(toDir);
    }
  }

  // Create layers
  const layers: ArchitectureLayer[] = [];
  for (const [dir, files] of groups) {
    if (dir === '') {
      // Root-level files go into an "Application" layer
      layers.push({
        name: 'Application',
        include: { files: files.map(f => f.file) },
      });
      continue;
    }

    const name = dir.charAt(0).toUpperCase() + dir.slice(1);
    const layer: ArchitectureLayer = {
      name,
      include: { patterns: [`${dir}/**`] },
    };

    const accesses = accessMap.get(dir);
    if (accesses && accesses.size > 0) {
      layer.may_only_access = [...accesses].map(
        d => d.charAt(0).toUpperCase() + d.slice(1),
      );
    }

    layers.push(layer);
  }

  return {
    version: 2,
    inferred_by: 'heuristic',
    inferred_at: new Date().toISOString(),
    layers: layers.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
