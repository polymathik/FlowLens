import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { Annotation } from '../contracts/mcp/annotations.js';

export class AnnotationStore {
  private annotations: Annotation[] = [];
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    if (!existsSync(this.filePath)) {
      this.annotations = [];
      return;
    }
    const content = await readFile(this.filePath, 'utf-8');
    const data = JSON.parse(content);
    this.annotations = data.annotations ?? [];
  }

  async save(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify({ annotations: this.annotations }, null, 2));
  }

  add(input: Omit<Annotation, 'id' | 'created_at' | 'updated_at'>): Annotation {
    const now = new Date().toISOString();
    const annotation: Annotation = {
      ...input,
      id: 'ann_' + randomBytes(4).toString('hex'),
      created_at: now,
      updated_at: now,
    };
    this.annotations.push(annotation);
    return annotation;
  }

  getForEntity(entityId: string): Annotation[] {
    return this.annotations.filter(a => a.entity_id === entityId);
  }

  getAll(): Annotation[] {
    return [...this.annotations];
  }

  delete(annotationId: string): boolean {
    const idx = this.annotations.findIndex(a => a.id === annotationId);
    if (idx === -1) return false;
    this.annotations.splice(idx, 1);
    return true;
  }
}
