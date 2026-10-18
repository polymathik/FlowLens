/**
 * "Open in editor" links: `<scheme>://file/<absolute path>:<line>:<column>`
 * (VS Code, Cursor, VS Code Insiders, Windsurf share the format). The path
 * is the project root joined with the repo-relative file.
 */
import type { EditorScheme } from '../../contracts/canvas/index.js';

export const EDITOR_LABELS: Record<EditorScheme, string> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  'vscode-insiders': 'VS Code Insiders',
  windsurf: 'Windsurf',
};

/** Join root and repo-relative file with forward slashes (Windows drive letters kept). */
export function absolutePath(root: string, file: string): string {
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const f = file.replace(/\\/g, '/').replace(/^\.?\/+/, '');
  return r ? `${r}/${f}` : f;
}

/** Link that opens `file` at `line` (1-based) in the chosen editor; null when the project root is unknown. */
export function editorUrl(scheme: EditorScheme, root: string, file: string, line?: number, column?: number): string | null {
  if (!root || !file) return null;
  const abs = absolutePath(root, file);
  const path = abs.startsWith('/') ? abs : `/${abs}`;
  const pos = line ? `:${line}${column !== undefined ? `:${column + 1}` : ''}` : '';
  return `${scheme}://file${encodeURI(path)}${pos}`;
}
