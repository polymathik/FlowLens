import path from 'node:path';
import { parse } from '@ast-grep/napi';
import type { SgRoot } from '@ast-grep/napi';
import type { Parser, ParseResult, ParseError } from '../contracts/parser.js';
import { isPending } from './pending.js';
import {
  LANGUAGE_EXTENSIONS,
  extensionToLanguage,
  normalizeRelativePath,
} from '../utils/paths.js';
import { countLines, createFileEntity } from './file-entity.js';
import { ensureLanguagesRegistered } from './lang-registration.js';
import { extractorRegistry } from './extractor-registry.js';
import { typescriptExtractor, createTypescriptExtractor } from './extractors/typescript-extractor.js';
import { registerAllExtractors } from './extractors/register-all.js';
import { populateEntityMetrics } from '../metrics/compute-entity-metrics.js';
import { dedupeEntities } from './entity-dedupe.js';
import { findSyntaxErrorLines } from './ast-walk.js';
import { aggregateRelations } from '../graph/aggregate.js';

export { createFileEntity } from './file-entity.js';

// ─── Register built-in extractors ────────────────────────────────
extractorRegistry.register(typescriptExtractor);
for (const lang of ['tsx', 'jsx', 'javascript'] as const) {
  if (!extractorRegistry.has(lang)) {
    extractorRegistry.register(createTypescriptExtractor(lang));
  }
}
registerAllExtractors();

/**
 * Maps our internal language names to the string identifiers accepted by
 * `@ast-grep/napi`'s `parse()` (built-ins PascalCase, dynamic ones lowercase).
 */
const LANG_TO_AST_GREP: Record<string, string> = {
  typescript: 'TypeScript',
  tsx: 'Tsx',
  javascript: 'JavaScript',
  jsx: 'Tsx',
  css: 'Css',
  html: 'Html',
  python: 'python',
  go: 'go',
  rust: 'rust',
  java: 'java',
  kotlin: 'kotlin',
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
  php: 'php',
  ruby: 'ruby',
  swift: 'swift',
  scala: 'scala',
  bash: 'bash',
  json: 'json',
  yaml: 'yaml',
};

function tryParse(lang: string, content: string, filePath: string, errors: ParseError[]): SgRoot | null {
  try {
    return parse(lang, content);
  } catch (err: unknown) {
    errors.push({
      file: filePath, line: 0, column: 0,
      message: err instanceof Error ? err.message : 'Unknown parse error',
      severity: 'error',
    });
    return null;
  }
}

/**
 * AstGrepParser implements the Parser contract using @ast-grep/napi.
 *
 * Deep extraction (languages with a registered extractor): entities,
 * direct relations, pending cross-file relations and file symbols.
 * Basic extraction (others): a file entity, plus syntax validation.
 * Extraction never throws: a crashing extractor yields `failed: true` and
 * an error, and the indexer keeps the previous graph data for the file.
 */
export class AstGrepParser implements Parser {
  private rootDir: string;

  /** @param rootDir - project root used for import resolution ('' disables it). */
  constructor(rootDir: string = '') {
    this.rootDir = rootDir;
  }

  async parseFile(filePath: string, content: string): Promise<ParseResult> {
    ensureLanguagesRegistered();
    const normalized = normalizeRelativePath(filePath);
    const language = extensionToLanguage(path.extname(normalized)) ?? 'unknown';
    const errors: ParseError[] = [];
    const fileEntity = createFileEntity(normalized, language, countLines(content));
    const result: ParseResult = { file: normalized, language, entities: [fileEntity], relations: [], errors };
    const astGrepLang = LANG_TO_AST_GREP[language];
    if (!astGrepLang || content.length === 0) return result;

    const sgRoot = tryParse(astGrepLang, content, normalized, errors);
    if (!sgRoot) {
      result.failed = true;
      return result;
    }
    const root = sgRoot.root();
    // JSON files are often JSONC (tsconfig, .vscode) — comments are not errors there.
    const errorLines = language === 'json' ? [] : findSyntaxErrorLines(root);
    if (errorLines.length > 0) {
      result.syntax_errors = errorLines.length;
      errors.push({
        file: normalized, line: errorLines[0], column: 0,
        message: `${errorLines.length} syntax error(s), first at line ${errorLines[0]}`,
        severity: 'warning',
      });
    }

    const extractor = extractorRegistry.get(language);
    if (!extractor) return result;
    try {
      const { entities, duplicates } = dedupeEntities([fileEntity, ...extractor.extractEntities(root, normalized)]);
      populateEntityMetrics(root, entities, { cognitive: extractor.cognitiveComplexity === true });
      const symbols = extractor.extractSymbols?.(root, normalized, entities, this.rootDir);
      const all = extractor.extractRelations(root, normalized, entities, this.rootDir, symbols);
      result.entities = entities;
      result.relations = aggregateRelations(all.filter((r) => !isPending(r)));
      result.pending = all.filter(isPending);
      if (symbols) result.symbols = symbols;
      if (duplicates > 0) result.duplicate_declarations = duplicates;
    } catch (err: unknown) {
      result.entities = [fileEntity];
      result.relations = [];
      result.failed = true;
      errors.push({
        file: normalized, line: 0, column: 0,
        message: `extraction failed: ${err instanceof Error ? err.message : String(err)}`,
        severity: 'error',
      });
    }
    return result;
  }

  supportsExtension(ext: string): boolean {
    return ext in LANGUAGE_EXTENSIONS;
  }

  supportedExtensions(): string[] {
    return Object.keys(LANGUAGE_EXTENSIONS);
  }

  hasDeepExtractor(language: string): boolean {
    return extractorRegistry.has(language);
  }
}
