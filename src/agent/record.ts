/**
 * The recorder's extraction: which repo files a FlowLens MCP tool call was ABOUT. Only tools that answer
 * "what is this symbol/module and who depends on it" credit files (the gate treats a credited file as
 * checked); other FlowLens tools are still logged (stats) but credit nothing. Pure and tolerant: the
 * response shape of an MCP tool in a PostToolUse hook varies by agent (string, content blocks, wrapped).
 */
import { FLOWLENS_TOOL_PREFIX } from '../contracts/agent-setup.js';

/** Tools whose result is about one entity's file (`data.entity.file`). */
const ENTITY_TOOLS = new Set(['get_context', 'get_dependents', 'traverse']);
/** Tools whose result lists a module's members (`data.exports[].entity.file`). */
const MODULE_TOOLS = new Set(['get_module_interface']);

export function flowlensToolName(toolName: unknown): string | null {
  return typeof toolName === 'string' && toolName.startsWith(FLOWLENS_TOOL_PREFIX)
    ? toolName.slice(FLOWLENS_TOOL_PREFIX.length)
    : null;
}

/** The text of an MCP tool response in any of the shapes agents pass to hooks. */
export function responseText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (Array.isArray(response)) return response.map(responseText).filter(Boolean).join('\n');
  if (typeof response !== 'object' || response === null) return '';
  const r = response as Record<string, unknown>;
  if (typeof r.text === 'string') return r.text;
  if (Array.isArray(r.content)) return responseText(r.content);
  if (r.data !== undefined) return JSON.stringify(response);
  return '';
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const asFile = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v.replaceAll('\\', '/') : null);

/** Repo-relative files the call covers (empty for tools that credit nothing or on an error result). */
export function creditedFiles(tool: string, response: unknown): string[] {
  if (!ENTITY_TOOLS.has(tool) && !MODULE_TOOLS.has(tool)) return [];
  const body = parseJson(responseText(response)) as { data?: Record<string, unknown> } | undefined;
  const data = body?.data;
  if (!data || typeof data !== 'object') return [];
  const files = new Set<string>();
  if (ENTITY_TOOLS.has(tool)) {
    const f = asFile((data.entity as { file?: unknown } | undefined)?.file);
    if (f) files.add(f);
  } else if (Array.isArray(data.exports)) {
    for (const e of data.exports as Array<{ entity?: { file?: unknown } }>) {
      const f = asFile(e?.entity?.file);
      if (f) files.add(f);
    }
  }
  return [...files];
}
