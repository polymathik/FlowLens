import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ClaudeHookInput } from '../contracts/agent.js';

export type { ClaudeHookInput } from '../contracts/agent.js';

export function promptFromHook(input: ClaudeHookInput): string | undefined {
  return typeof input.prompt === 'string' ? input.prompt : undefined;
}

/**
 * Project root for an agent command: `--root` (hooks pass "$CLAUDE_PROJECT_DIR";
 * an empty value means the variable was unset), then the hook input `cwd`,
 * then process.cwd(). If the candidate has no `.flowlens/`, the nearest parent
 * that has one wins (monorepo subdirectories), otherwise the candidate itself.
 */
export function resolveAgentRoot(
  rootOption: string | undefined,
  hookInput: ClaudeHookInput,
  cwd: string = process.cwd(),
): string {
  const candidate = nonEmpty(rootOption) ?? nonEmpty(hookInput.cwd) ?? cwd;
  const start = resolve(candidate);
  let dir = start;
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, '.flowlens'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export function changedFilesFromHook(input: ClaudeHookInput, rootDir: string): string[] {
  const files = new Set<string>();
  const add = (file: unknown) => addFile(files, file, rootDir);
  add(input.tool_input?.file_path);
  add(input.tool_input?.filePath);
  add(input.tool_input?.notebook_path);
  add(input.tool_response?.filePath);
  add(input.tool_response?.file_path);
  for (const edit of input.tool_input?.edits ?? []) {
    add(edit.file_path);
    add(edit.filePath);
  }
  return [...files].sort();
}

export async function readHookInput(stdin: NodeJS.ReadableStream): Promise<ClaudeHookInput> {
  if ((stdin as NodeJS.ReadStream).isTTY) return {};
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk as Buffer));
  return parseHookInput(Buffer.concat(chunks).toString('utf-8'));
}

export function parseHookInput(raw: string): ClaudeHookInput {
  const text = raw.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as ClaudeHookInput
      : {};
  } catch {
    return {};
  }
}

function addFile(files: Set<string>, file: unknown, rootDir: string): void {
  if (typeof file !== 'string' || !file) return;
  const absoluteRoot = resolve(rootDir);
  const normalizedInput = file.replaceAll('\\', '/');
  const rel = isAbsolute(file) || /^[A-Za-z]:\//.test(normalizedInput)
    ? relative(absoluteRoot, file).replaceAll('\\', '/')
    : normalizedInput.replace(/^\.\//, '');
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) files.add(rel);
}

function nonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  // An unexpanded placeholder (e.g. run outside Claude Code) means "not set".
  return value.includes('${') ? undefined : value;
}
