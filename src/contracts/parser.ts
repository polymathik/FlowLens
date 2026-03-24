import type { Entity } from './entities.js';
import type { Relation } from './relations.js';

export interface ParseResult {
  file: string;
  language: string;
  entities: Entity[];
  relations: Relation[];
  errors: ParseError[];
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
