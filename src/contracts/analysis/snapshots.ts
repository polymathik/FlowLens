import type { Entity } from '../entities.js';
import type { Relation } from '../relations.js';

export type SnapshotIndex = {
  [sha: string]: {
    timestamp: string;
    entity_count: number;
    relation_count: number;
  };
};

export type SnapshotData = {
  sha: string;
  timestamp: string;
  entities: Entity[];
  relations: Relation[];
};
