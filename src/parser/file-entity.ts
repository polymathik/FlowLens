/**
 * The `file` entity every indexed file gets — including files with no
 * symbols (barrel `index.ts`, `app.d.ts`, `.css`, config files). It is what
 * lets a map show every file, and it carries the file's role (Map M0, D6/D7).
 */
import path from 'node:path';
import type { Entity } from '../contracts/entities.js';
import { generateEntityId } from '../utils/id.js';
import { normalizeRelativePath } from '../utils/paths.js';
import { classifyFile } from './file-role.js';

/** Line count; a trailing newline does not add a line. */
export function countLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split('\n');
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

/** File-level entity for any parsed or unparsed source file. */
export function createFileEntity(filePath: string, language: string, lineCount: number): Entity {
  const normalized = normalizeRelativePath(filePath);
  const fileName = path.basename(normalized);
  return {
    id: generateEntityId(normalized, fileName, 'file'),
    kind: 'file',
    name: fileName,
    qualified_name: normalized,
    file: normalized,
    location: { line_start: 1, line_end: Math.max(lineCount, 0), column_start: 0, column_end: 0 },
    visibility: 'public',
    language,
    metrics: { line_count: lineCount },
    file_role: classifyFile(normalized),
  };
}
