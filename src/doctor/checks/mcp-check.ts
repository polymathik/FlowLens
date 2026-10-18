/**
 * MCP check — actually builds the FlowLens MCP server with the same
 * dependencies `flowlens serve` uses, connects an in-process client over
 * the SDK's linked in-memory transport, and lists the registered tools.
 * No port, no subprocess, no network: if this passes, `serve` will be able
 * to answer `tools/list` for Claude Code.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFlowLensServer } from '../../mcp/server.js';
import { AnnotationStore } from '../../mcp/annotation-store.js';
import { SnapshotManager } from '../../analysis/snapshot-manager.js';
import type { DiagnosticCheck, DiagnosticRunner, DoctorContext } from '../../contracts/doctor.js';
import { isGraphLockedError } from '../../agent/graph-access.js';
import { graphErrorMessage, lockedMessage, openDoctorGraph } from './open-graph.js';

/** Tools every FlowLens MCP server must expose (Phase 4 contract). */
export const EXPECTED_MCP_TOOLS = [
  'get_context',
  'get_dependents',
  'get_module_interface',
  'annotate',
  'traverse',
  'detect_cycles',
  'get_metrics',
  'diff_interface',
  'check_architecture',
  'get_summary',
  'get_hotspots',
  'get_layer_map',
] as const;

const BASE = { name: 'mcp-reachable', title: 'MCP server initializes' };

export const mcpReachableCheck: DiagnosticRunner = async (ctx) => {
  const { rootDir, flowlensDir } = ctx;
  const graphPath = join(flowlensDir, 'graph');
  if (!existsSync(graphPath)) {
    return { ...BASE, status: 'error', message: 'cannot init MCP: graph missing' };
  }

  const opened = await openDoctorGraph(ctx);
  if (!opened.ok) return opened.locked ? lockedResult(ctx) : { ...BASE, status: 'error', message: `MCP init would fail: ${opened.message}` };
  const graph = opened.graph;

  const client = new Client({ name: 'flowlens-doctor', version: '0.0.0' });
  try {
    const annotationStore = new AnnotationStore(join(flowlensDir, 'annotations.json'));
    await annotationStore.load();
    const server = createFlowLensServer({
      graph,
      annotationStore,
      snapshotManager: new SnapshotManager(join(flowlensDir, 'snapshots')),
      flowlensDir,
      rootDir,
      fileIndexPath: join(flowlensDir, 'file_index.json'),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    // Exercise one real tool so a graph that cannot be read is not a pass.
    const probe = await client.callTool({ name: 'get_summary', arguments: {} });
    if (probe.isError) {
      const text = JSON.stringify(probe.content ?? '');
      if (/graph_locked|lock/i.test(text)) return lockedResult(ctx);
      return { ...BASE, status: 'error', message: 'MCP server started but get_summary failed', details: text.slice(0, 300) };
    }
    return toolsResult(tools.map((t) => t.name));
  } catch (err) {
    if (isGraphLockedError(err)) return lockedResult(ctx);
    return {
      ...BASE,
      status: 'error',
      message: `MCP server failed to start: ${errorMessage(err)}`,
    };
  } finally {
    await client.close().catch(() => {});
    await graph.close().catch(() => {});
  }
};

/** Pure: grade the listed tool names against the expected set. */
export function toolsResult(names: string[]): DiagnosticCheck {
  const missing = EXPECTED_MCP_TOOLS.filter((t) => !names.includes(t));
  if (missing.length > 0) {
    return {
      ...BASE,
      status: 'error',
      message: `MCP server is missing ${missing.length} tool(s)`,
      details: `missing: ${missing.join(', ')}`,
    };
  }
  return {
    ...BASE,
    status: 'ok',
    message: `MCP server started in-process; ${names.length} tools listed`,
    details: names.join(', '),
  };
}

function lockedResult(ctx: DoctorContext): DiagnosticCheck {
  return { ...BASE, status: 'warning', message: `${lockedMessage(ctx)} — MCP not verified` };
}

function errorMessage(err: unknown): string {
  return graphErrorMessage(err);
}
