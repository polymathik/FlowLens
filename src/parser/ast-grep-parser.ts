import path from 'node:path';
import { parse } from '@ast-grep/napi';
import type { SgRoot } from '@ast-grep/napi';
import type { Parser, ParseResult, ParseError } from '../contracts/parser.js';
import type { Entity } from '../contracts/entities.js';
import {
  LANGUAGE_EXTENSIONS,
  extensionToLanguage,
  isDeepExtractionLanguage,
  normalizeRelativePath,
} from '../utils/paths.js';
import { generateEntityId } from '../utils/id.js';
import { extractEntities } from './entity-extractor.js';
import { extractRelations } from './relation-extractor.js';

/**
 * Maps our internal language names to the string identifiers accepted by
 * `@ast-grep/napi`'s `parse()`. Only languages that ast-grep natively
 * supports are included. Languages not in this map can still produce a
 * basic file entity — they just skip AST parsing.
 */
const LANG_TO_AST_GREP: Record<string, string> = {
  typescript: 'TypeScript',
  tsx: 'Tsx',
  javascript: 'JavaScript',
  jsx: 'Tsx', // ast-grep's Tsx grammar handles JSX
  css: 'Css',
  html: 'Html',
};

/**
 * Count the number of non-empty content lines in source text.
 * An empty string has 0 lines. A trailing newline does not add an extra line.
 */
function countLines(content: string): number {
  if (content.length === 0) return 0;
  // Split on newlines, remove the trailing empty element from a final '\n'
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') {
    return lines.length - 1;
  }
  return lines.length;
}

/**
 * Build a file-level `Entity` for any parsed or unparsed source file.
 */
function createFileEntity(
  filePath: string,
  language: string,
  lineCount: number,
): Entity {
  const normalized = normalizeRelativePath(filePath);
  const fileName = path.basename(normalized);

  return {
    id: generateEntityId(normalized, fileName, 'file'),
    kind: 'file',
    name: fileName,
    qualified_name: normalized,
    file: normalized,
    location: {
      line_start: 1,
      line_end: Math.max(lineCount, 0),
      column_start: 0,
      column_end: 0,
    },
    visibility: 'public',
    language,
    metrics: {
      line_count: lineCount,
    },
  };
}

/**
 * Try to parse source content with ast-grep. Returns the SgRoot on
 * success or `null` on failure (with the error pushed into `errors`).
 */
function tryParse(
  astGrepLang: string,
  content: string,
  filePath: string,
  errors: ParseError[],
): SgRoot | null {
  try {
    return parse(astGrepLang, content);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Unknown parse error';
    errors.push({
      file: filePath,
      line: 0,
      column: 0,
      message,
      severity: 'error',
    });
    return null;
  }
}

/**
 * AstGrepParser implements the Parser contract using @ast-grep/napi.
 *
 * Two-tier extraction model:
 *  - Deep extraction (TS/JS/JSX/TSX): parse with ast-grep, delegate to
 *    entity-extractor for entity extraction and relation-extractor.
 *  - Basic extraction (all other languages): create a file entity with
 *    line_count. If ast-grep supports the language, parse to validate syntax.
 */
export class AstGrepParser implements Parser {
  /**
   * Parse a source file and return entities, relations, and any parse errors.
   */
  async parseFile(filePath: string, content: string): Promise<ParseResult> {
    const normalized = normalizeRelativePath(filePath);
    const ext = path.extname(normalized);
    const language = extensionToLanguage(ext) ?? 'unknown';
    const lineCount = countLines(content);
    const errors: ParseError[] = [];
    const entities: Entity[] = [];
    let relations: import('../contracts/relations.js').Relation[] = [];

    const fileEntity = createFileEntity(normalized, language, lineCount);
    const astGrepLang = LANG_TO_AST_GREP[language];

    if (isDeepExtractionLanguage(language)) {
      // Deep extraction path — parse with ast-grep, then extract entities & relations
      if (astGrepLang && content.length > 0) {
        const sgRoot = tryParse(astGrepLang, content, normalized, errors);

        if (sgRoot) {
          const extractedEntities = extractEntities(sgRoot.root(), normalized, language);
          entities.push(...extractedEntities);

          relations = extractRelations(sgRoot.root(), normalized, extractedEntities, '');
        }
      }

      // Always include the file entity, even if deep extraction produced others
      entities.push(fileEntity);
    } else {
      // Basic extraction path — optionally validate via ast-grep if supported
      if (astGrepLang && content.length > 0) {
        tryParse(astGrepLang, content, normalized, errors);
      }

      entities.push(fileEntity);
    }

    return {
      file: normalized,
      language,
      entities,
      relations,
      errors,
    };
  }

  /**
   * Check whether the given file extension is in our supported set.
   */
  supportsExtension(ext: string): boolean {
    return ext in LANGUAGE_EXTENSIONS;
  }

  /**
   * Return all file extensions this parser recognizes.
   */
  supportedExtensions(): string[] {
    return Object.keys(LANGUAGE_EXTENSIONS);
  }

  /**
   * Check whether the given language has a deep (entity + relation) extractor.
   */
  hasDeepExtractor(language: string): boolean {
    return isDeepExtractionLanguage(language);
  }
}

