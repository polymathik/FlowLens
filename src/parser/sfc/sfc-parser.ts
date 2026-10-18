/**
 * Single-file component parsing (`.svelte`, `.vue`) — Map M0, D2.
 *
 * Per file the graph gets:
 *   - the usual `file` entity,
 *   - one `component` entity (named after the file; the file's default export),
 *   - every symbol of the `<script>` blocks, extracted by the TypeScript
 *     extractor from a line-preserving masked copy (see blocks.ts) so entity
 *     lines match the original file,
 *   - `import` edges (script imports), `call`/`use`/… edges from script code
 *     (top-level script code belongs to the component entity),
 *   - `create` edges component → component for `<Child />` tags that match an
 *     import (or a same-file entity), and `call` edges for template
 *     expressions that call imported or local functions.
 */
import path from 'node:path';
import { parse } from '@ast-grep/napi';
import type { SgNode } from '@ast-grep/napi';
import type { ParseError, ParseResult } from '../../contracts/parser.js';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import type { FileSymbols } from '../../contracts/symbols.js';
import { generateEntityId } from '../../utils/id.js';
import { aggregateRelations } from '../../graph/aggregate.js';
import { populateEntityMetrics } from '../../metrics/compute-entity-metrics.js';
import { extractEntities } from '../entity-extractor.js';
import { extractRelations } from '../relation-extractor.js';
import { extractTsSymbols } from '../symbols/ts-symbols.js';
import { RelationEmitter } from '../symbols/emitter.js';
import { dedupeEntities } from '../entity-dedupe.js';
import { findSyntaxErrorLines } from '../ast-walk.js';
import { countLines, createFileEntity } from '../file-entity.js';
import { isPending } from '../pending.js';
import { maskToScript, type SfcFlavor } from './blocks.js';
import { scanTemplate, type TemplateRef } from './template-scan.js';

export const SFC_LANGUAGES: ReadonlySet<string> = new Set(['svelte', 'vue']);

export function isSfcLanguage(language: string): language is SfcFlavor {
  return SFC_LANGUAGES.has(language);
}

/** `Zone.svelte` → `Zone`; dots are replaced because qualified names use them as scope separators. */
export function componentNameOf(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).replace(/\./g, '_');
}

function componentEntity(filePath: string, language: string, lineCount: number): Entity {
  const name = componentNameOf(filePath);
  const qualified = `${filePath}/${name}`;
  return {
    id: generateEntityId(filePath, qualified, 'component'),
    kind: 'component',
    name,
    qualified_name: qualified,
    file: filePath,
    location: { line_start: 1, line_end: Math.max(lineCount, 1), column_start: 0, column_end: 0 },
    visibility: 'public',
    language,
    metrics: { line_count: lineCount },
  };
}

/** Candidate binding names for a tag: as written, PascalCase, camelCase (Vue kebab-case tags). */
function tagCandidates(name: string, flavor: SfcFlavor): string[] {
  if (flavor !== 'vue' || !name.includes('-')) return [name];
  const pascal = name.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return [pascal, pascal.charAt(0).toLowerCase() + pascal.slice(1), name];
}

function templateRelations(
  content: string, flavor: SfcFlavor, component: Entity, entities: Entity[], symbols: FileSymbols,
): Relation[] {
  const emitter = new RelationEmitter(component.file, entities, symbols);
  const scan = scanTemplate(content, flavor);
  const at = (r: TemplateRef) => ({ line: r.line, column: r.column });
  for (const tag of scan.tags) {
    const name = tagCandidates(tag.name, flavor).find((c) => {
      const head = c.split('.')[0];
      return emitter.isImported(head) || (emitter.isLocal(head) && head !== component.name);
    });
    if (name) emitter.link(component, 'create', name, at(tag), { kinds: ['component', 'class'] });
  }
  for (const call of scan.calls) emitter.link(component, 'call', call.name, at(call), { optional: true });
  return emitter.relations;
}

export function parseSfc(
  filePath: string, content: string, language: SfcFlavor, rootDir: string,
): ParseResult {
  const errors: ParseError[] = [];
  const lineCount = countLines(content);
  const fileEntity = createFileEntity(filePath, language, lineCount);
  const component = componentEntity(filePath, language, lineCount);
  const result: ParseResult = { file: filePath, language, entities: [fileEntity, component], relations: [], errors };
  const symbols: FileSymbols = { file: filePath, language, imports: [], exports: [], reexports: [] };
  let entities: Entity[] = result.entities;
  let relations: Relation[] = [];
  let root: SgNode | null = null;

  const masked = maskToScript(content);
  if (masked.grammar) {
    try {
      root = parse(masked.grammar, masked.source).root();
    } catch (err) {
      errors.push({
        file: filePath, line: 0, column: 0, severity: 'error',
        message: err instanceof Error ? err.message : 'Unknown parse error',
      });
    }
  }

  if (root) {
    const errorLines = findSyntaxErrorLines(root);
    if (errorLines.length > 0) {
      result.syntax_errors = errorLines.length;
      errors.push({
        file: filePath, line: errorLines[0], column: 0, severity: 'warning',
        message: `${errorLines.length} syntax error(s), first at line ${errorLines[0]}`,
      });
    }
    try {
      const deduped = dedupeEntities([fileEntity, component, ...extractEntities(root, filePath, language)]);
      entities = deduped.entities;
      if (deduped.duplicates > 0) result.duplicate_declarations = deduped.duplicates;
      populateEntityMetrics(root, entities, { cognitive: true });
      Object.assign(symbols, extractTsSymbols(root, filePath, rootDir, language));
      relations = extractRelations(root, filePath, entities, rootDir, symbols, component);
    } catch (err) {
      entities = [fileEntity, component];
      relations = [];
      result.failed = true;
      errors.push({
        file: filePath, line: 0, column: 0, severity: 'error',
        message: `extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // The component is the file's default export; script `export`s (module script, props) stay as written.
  symbols.exports.push({ name: 'default', local: component.name });
  delete symbols.implicit_exports;

  if (!result.failed) relations = [...relations, ...templateRelations(content, language, component, entities, symbols)];
  result.entities = entities;
  result.symbols = symbols;
  result.relations = aggregateRelations(relations.filter((r) => !isPending(r)));
  result.pending = relations.filter(isPending);
  return result;
}
