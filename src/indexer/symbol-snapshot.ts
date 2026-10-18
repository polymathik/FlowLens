/**
 * Persisted symbol records — `.flowlens/symbols.json`.
 *
 * One `FileSymbolRecord` per indexed file (imports, exports, entity
 * summaries, class parents). Incremental runs rebuild the project symbol
 * table from it so changed files resolve against unchanged ones without
 * re-parsing them, and so the reverse-import index can find dependents.
 * A missing or unreadable snapshot just means "full re-resolution".
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { FileSymbolRecord, FileSymbols, SymbolEntity } from '../contracts/symbols.js';
import type { ParsedFileOutput } from './parallel-parser.js';
import { writeFileAtomicAsync } from '../projects/atomic.js';

const SNAPSHOT_VERSION = 1;

interface SnapshotFile {
  version: number;
  files: Record<string, FileSymbolRecord>;
}

export async function loadSymbolSnapshot(path: string): Promise<Map<string, FileSymbolRecord>> {
  if (!existsSync(path)) return new Map();
  try {
    const raw = JSON.parse(await readFile(path, 'utf-8')) as SnapshotFile;
    if (raw.version !== SNAPSHOT_VERSION || !raw.files) return new Map();
    return new Map(Object.entries(raw.files));
  } catch {
    return new Map();
  }
}

export async function saveSymbolSnapshot(path: string, records: Map<string, FileSymbolRecord>): Promise<void> {
  const data: SnapshotFile = { version: SNAPSHOT_VERSION, files: Object.fromEntries(records) };
  // Unique tmp name per write: two writers in one process never share a tmp file.
  await writeFileAtomicAsync(path, JSON.stringify(data));
}

/** Build the symbol record of a freshly parsed file. */
export function recordFromParsed(file: ParsedFileOutput): FileSymbolRecord {
  const symbols: FileSymbols = file.symbols ?? {
    file: file.path, language: file.language, imports: [], exports: [], reexports: [], implicit_exports: true,
  };
  const entities: SymbolEntity[] = file.entities
    .filter((e) => e.kind !== 'parameter')
    .map((e): SymbolEntity => {
      const sym: SymbolEntity = { id: e.id, name: e.name, qualified_name: e.qualified_name, kind: e.kind, file: e.file, language: e.language };
      if (e.annotations?.type_ref) sym.type_ref = e.annotations.type_ref;
      return sym;
    });
  const extendsRefs: FileSymbolRecord['extends'] = [];
  for (const r of file.relations) if (r.type === 'extend') extendsRefs.push({ from: r.from, to: r.to });
  for (const r of file.pending) if (r.type === 'extend') extendsRefs.push({ from: r.from, target_name: r.target_name });
  // A class with a base class that left no relation (external or unresolvable base): record that it has one.
  const known = new Set(extendsRefs.map((x) => x.from));
  for (const e of file.entities) if (e.kind === 'class' && e.annotations?.extends && !known.has(e.id)) extendsRefs.push({ from: e.id });
  const rec: FileSymbolRecord = { symbols, entities, extends: extendsRefs };
  if (file.duplicate_declarations > 0) rec.duplicates = file.duplicate_declarations;
  if (file.syntax_errors > 0) rec.syntax_errors = file.syntax_errors;
  return rec;
}
