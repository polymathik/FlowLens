/** Shared plumbing for the entry-point detectors. */
import type { Entity } from '../../contracts/entities.js';
import type { EntryPoint, EntryPointKind, HandlerSpan } from '../../contracts/flow.js';
import type { FlowGraph } from '../graph.js';
import { lineStartsOf, type SourceProvider } from '../source.js';
import type { ArgContext } from '../handler.js';

export interface SourceFile {
  file: string;
  text: string;
  starts: number[];
}

export class DetectContext {
  private readonly texts = new Map<string, SourceFile | null>();

  constructor(readonly graph: FlowGraph, private readonly provider: SourceProvider) {}

  /** Text of a graph file (cached; null when unreadable or not a graph file). */
  source(file: string): SourceFile | null {
    let hit = this.texts.get(file);
    if (hit === undefined) {
      const text = this.graph.fileEntity.has(file) ? this.provider(file) : undefined;
      hit = text === undefined ? null : { file, text, starts: lineStartsOf(text) };
      this.texts.set(file, hit);
    }
    return hit;
  }

  args(src: SourceFile): ArgContext {
    return { graph: this.graph, file: src.file, text: src.text, starts: src.starts };
  }

  /** Source files worth scanning as text: indexed TS/JS/Svelte/Vue files that are not tests. */
  scriptFiles(): Entity[] {
    return this.graph.sourceFiles().filter((f) => f.file_role !== 'test' && !this.graph.isTestFile(f.file) && /^(?:typescript|javascript|svelte|vue|tsx|jsx)$/.test(f.language));
  }
}

export interface EntryInit {
  entity: Entity;
  file?: string;
  line?: number;
  kind: EntryPointKind;
  label: string;
  confidence: number;
  evidence: string;
  span?: HandlerSpan;
}

export function makeEntry(i: EntryInit): EntryPoint {
  const conf = Math.round(Math.min(1, Math.max(0, i.confidence)) * 100) / 100;
  return {
    entity_id: i.entity.id,
    qualified_name: i.entity.qualified_name,
    file: i.file ?? i.entity.file,
    line: i.line ?? i.entity.location.line_start,
    kind: i.kind,
    label: i.label,
    confidence: conf,
    evidence: i.evidence,
    ...(i.span ? { span: i.span } : {}),
  };
}

export type Detector = (ctx: DetectContext) => EntryPoint[];

/** Directory of a repo-relative file ('' for root files). */
export const dirOf = (file: string): string => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
export const baseOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1);
