import { relative, resolve } from 'node:path';

export type ClaudeHookInput = {
  prompt?: string;
  cwd?: string;
  tool_input?: {
    file_path?: string;
    filePath?: string;
    edits?: Array<{ file_path?: string; filePath?: string }>;
  };
  tool_response?: {
    filePath?: string;
    file_path?: string;
  };
};

export function promptFromHook(input: ClaudeHookInput): string | undefined {
  return typeof input.prompt === 'string' ? input.prompt : undefined;
}

export function changedFilesFromHook(
  input: ClaudeHookInput,
  rootDir: string,
): string[] {
  const files = new Set<string>();
  addFile(files, input.tool_input?.file_path, rootDir);
  addFile(files, input.tool_input?.filePath, rootDir);
  addFile(files, input.tool_response?.filePath, rootDir);
  addFile(files, input.tool_response?.file_path, rootDir);
  for (const edit of input.tool_input?.edits ?? []) {
    addFile(files, edit.file_path, rootDir);
    addFile(files, edit.filePath, rootDir);
  }
  return [...files].sort();
}

export async function readHookInput(stdin: NodeJS.ReadStream): Promise<ClaudeHookInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ClaudeHookInput;
  } catch {
    return {};
  }
}

function addFile(files: Set<string>, file: string | undefined, rootDir: string): void {
  if (!file) return;
  const absoluteRoot = resolve(rootDir);
  const normalized = file.startsWith('/')
    ? relative(absoluteRoot, file)
    : file;
  if (!normalized.startsWith('..')) {
    files.add(normalized.replaceAll('\\', '/'));
  }
}
