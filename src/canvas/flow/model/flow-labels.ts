/**
 * Words and short labels of the Flow view: entry kinds, card names, call-site labels, confidence.
 * Pure string helpers shared by the model, the picker and the bar.
 */
import type { EntryPointKind } from '../../../contracts/flow-constants.js';
import type { FlowNode } from '../../../contracts/flow.js';

/** Plain-language group names of the entry-point picker, in display order. */
export const ENTRY_KIND_LABELS: Record<EntryPointKind, string> = {
  http_route: 'HTTP routes',
  page_route: 'Pages',
  cli_command: 'CLI commands',
  bin: 'Executables (bin)',
  main: 'Main functions and scripts',
  event_handler: 'Event handlers',
  ui_component_root: 'UI roots',
  export_api: 'Exported API (a guess)',
  test: 'Tests',
  unknown: 'Other',
};

/** Short tag shown on a card that is an entry point. */
export const ENTRY_KIND_TAGS: Record<EntryPointKind, string> = {
  http_route: 'HTTP', page_route: 'PAGE', cli_command: 'CLI', bin: 'BIN', main: 'MAIN',
  event_handler: 'EVENT', ui_component_root: 'UI', export_api: 'API', test: 'TEST', unknown: 'START',
};

export const ENTRY_KIND_ORDER = Object.keys(ENTRY_KIND_LABELS) as EntryPointKind[];

export const baseName = (file: string): string => file.slice(file.lastIndexOf('/') + 1);

/** `app.ts:113`, with `×3` when the call site repeats. */
export function refLabel(file: string, line: number, count = 1): string {
  return `${baseName(file)}:${line}${count > 1 ? ` ×${count}` : ''}`;
}

/** `Class.method()` / `fn()`: the qualified name without its file prefix; classes keep no parentheses, a module is its file name. */
export function displayName(n: Pick<FlowNode, 'kind' | 'name' | 'qualified_name' | 'file'>): string {
  if (n.kind === 'file') return baseName(n.file);
  const prefix = `${n.file}/`;
  const rest = n.qualified_name.startsWith(prefix) ? n.qualified_name.slice(prefix.length) : n.name;
  return n.kind === 'function' || n.kind === 'method' ? `${rest}()` : rest;
}

export const percent = (confidence: number): string => `${Math.round(confidence * 100)}%`;

/** Confidence in words for the picker and tooltips. */
export function confidenceWord(confidence: number): string {
  if (confidence >= 0.85) return 'sure';
  if (confidence >= 0.6) return 'likely';
  return 'a guess';
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
