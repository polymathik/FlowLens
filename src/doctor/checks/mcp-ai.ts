import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LevelGraphStore } from '../../graph/levelgraph-store.js';
import type { DiagnosticRunner } from '../../contracts/doctor.js';

/**
 * Attempts to open the graph + dispatch a trivial query. A clean open/close
 * path proves the MCP server would start; we don't bind a port here.
 */
export const mcpReachableCheck: DiagnosticRunner = async ({ flowlensDir }) => {
  const base = { name: 'mcp-reachable', title: 'MCP server initializes' };
  const graphPath = join(flowlensDir, 'graph');
  if (!existsSync(graphPath)) {
    return {
      ...base,
      status: 'error',
      message: 'cannot init MCP: graph missing',
    };
  }
  const store = new LevelGraphStore();
  try {
    await store.open(graphPath);
    await store.getAllNodes();
    return { ...base, status: 'ok', message: 'MCP dependencies load cleanly' };
  } catch (err) {
    return {
      ...base,
      status: 'error',
      message: `MCP init would fail: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    try {
      await store.close();
    } catch {
      /* ignore */
    }
  }
};

/**
 * Inspects `.flowlens/config.json` for an `ai` block and reports what's
 * configured. Does NOT perform a live API call — that would require network
 * + a key and belongs in `flowlens doctor --deep` (future).
 */
export const aiConfiguredCheck: DiagnosticRunner = async ({ flowlensDir }) => {
  const base = { name: 'ai-configured', title: 'AI integration' };
  const configPath = join(flowlensDir, 'config.json');
  if (!existsSync(configPath)) {
    return {
      ...base,
      status: 'warning',
      message: 'AI integration not configured',
    };
  }
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf-8')) as {
      ai?: { provider?: string; model?: string };
    };
    if (!parsed.ai?.provider) {
      return {
        ...base,
        status: 'warning',
        message: 'AI integration not configured (optional)',
      };
    }
    return {
      ...base,
      status: 'ok',
      message: `AI provider: ${parsed.ai.provider}${parsed.ai.model ? ` (${parsed.ai.model})` : ''}`,
    };
  } catch {
    return {
      ...base,
      status: 'warning',
      message: 'could not parse config.json for AI block',
    };
  }
};
