import type { Entity } from './entities.js';
import type { Relation } from './relations.js';
import type { FileSymbols, PendingRelation } from './symbols.js';

export interface ParseResult {
  file: string;
  language: string;
  entities: Entity[];
  /** Relations whose targets are known after parsing this file alone (`resolution` 'direct'). */
  relations: Relation[];
  errors: ParseError[];
  /** Phase 8: cross-file references awaiting pass-2 resolution (`to === ''`). */
  pending?: PendingRelation[];
  /** Phase 8: imports / exports / re-exports of this file, input to the symbol table. */
  symbols?: FileSymbols;
  /**
   * Phase 8: entities dropped because an earlier declaration in the same file
   * had the same id (overloads, redefinitions, property setters). The first
   * declaration wins.
   */
  duplicate_declarations?: number;
  /** Phase 8: number of tree-sitter ERROR / MISSING nodes (syntax errors). */
  syntax_errors?: number;
  /** Phase 8: true when extraction threw and only a file entity was produced. */
  failed?: boolean;
}

export interface ParseError {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'warning' | 'error';
}

export interface Parser {
  parseFile(filePath: string, content: string): Promise<ParseResult>;
  supportsExtension(ext: string): boolean;
  supportedExtensions(): string[];
  hasDeepExtractor(language: string): boolean;
}
