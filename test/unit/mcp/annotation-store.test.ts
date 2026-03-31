import { describe, it, expect, beforeEach } from 'vitest';
import { AnnotationStore } from '../../../src/mcp/annotation-store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('AnnotationStore', () => {
  let tmpDir: string;
  let store: AnnotationStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-ann-'));
    store = new AnnotationStore(join(tmpDir, 'annotations.json'));
  });

  it('adds an annotation with generated ID', () => {
    const ann = store.add({ entity_id: 'e1', text: 'test', category: 'decision', author: 'human' });
    expect(ann.id).toMatch(/^ann_[0-9a-f]{8}$/);
    expect(ann.created_at).toBeDefined();
  });

  it('gets annotations for entity', () => {
    store.add({ entity_id: 'e1', text: 'a', category: 'decision', author: 'h' });
    store.add({ entity_id: 'e2', text: 'b', category: 'warning', author: 'h' });
    store.add({ entity_id: 'e1', text: 'c', category: 'todo', author: 'h' });
    expect(store.getForEntity('e1')).toHaveLength(2);
    expect(store.getForEntity('e2')).toHaveLength(1);
  });

  it('deletes an annotation', () => {
    const ann = store.add({ entity_id: 'e1', text: 'test', category: 'decision', author: 'h' });
    expect(store.delete(ann.id)).toBe(true);
    expect(store.getForEntity('e1')).toHaveLength(0);
  });

  it('returns false for deleting nonexistent', () => {
    expect(store.delete('ann_nonexist')).toBe(false);
  });

  it('saves and loads from disk', async () => {
    store.add({ entity_id: 'e1', text: 'persisted', category: 'convention', author: 'ai' });
    await store.save();

    const store2 = new AnnotationStore(join(tmpDir, 'annotations.json'));
    await store2.load();
    expect(store2.getForEntity('e1')).toHaveLength(1);
    expect(store2.getForEntity('e1')[0].text).toBe('persisted');
  });

  it('loads empty when file does not exist', async () => {
    await store.load();
    expect(store.getAll()).toHaveLength(0);
  });
});
