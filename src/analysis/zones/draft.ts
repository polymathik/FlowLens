/**
 * A zone draft is what a zoning strategy produces: which files form which
 * zone, nested through `parentKey`. `finalizeZones` turns drafts into a
 * `ZoneSet` (overrides, stats, colours, collapse, ordering), so every mode
 * shares one override/ordering pipeline and strategies stay tiny.
 */
import type { ZoneSource } from '../../contracts/zones.js';

export interface ZoneDraft {
  /** Stable key (see `Zone.key`). Unique within one draft list. */
  key: string;
  label: string;
  source: ZoneSource;
  /** Key of the enclosing draft, or null for a top-level zone. */
  parentKey: string | null;
  /** Hierarchy file-node ids directly in this zone. */
  fileIds: string[];
  /** Hierarchy node this zone mirrors. */
  nodeId?: string;
  /** Deeper folders were merged into this zone (depth cap): it starts collapsed. */
  absorbed?: boolean;
  /** Display position among siblings (declaration order of layers); zones without one sort after, by label. */
  order?: number;
  /** Starts collapsed (the muted Unassigned bucket); an override still wins. */
  startCollapsed?: boolean;
  /** Tooltip text for the zone chip. */
  detail?: string;
}

/** Insertion-ordered collection of drafts keyed by `ZoneDraft.key`. */
export class DraftBook {
  private readonly byKey = new Map<string, ZoneDraft>();

  add(draft: Omit<ZoneDraft, 'fileIds'> & { fileIds?: string[] }): ZoneDraft {
    const d: ZoneDraft = { ...draft, fileIds: draft.fileIds ?? [] };
    this.byKey.set(d.key, d);
    return d;
  }

  get(key: string): ZoneDraft | undefined {
    return this.byKey.get(key);
  }

  /** Get the draft for `key`, creating it with `make()` on first use. */
  ensure(key: string, make: () => Omit<ZoneDraft, 'fileIds' | 'key'>): ZoneDraft {
    return this.byKey.get(key) ?? this.add({ key, ...make() });
  }

  list(): ZoneDraft[] {
    return [...this.byKey.values()];
  }
}
