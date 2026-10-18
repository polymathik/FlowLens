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
import { LevelGraphStore } from '../../graph/levelgraph-store.js';
import { createFlowLensServer } from '../../mcp/server.js';
import { AnnotationStore } from '../../mcp/annotation-store.js';
import { SnapshotManager } from '../../analysis/snapshot-manager.js';
import type { DiagnosticCheck, DiagnosticRunner } from '../../contracts/doctor.js';

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

export const mcpReachableCheck: DiagnosticRunner = async ({ rootDir, flowlensDir }) => {
  const graphPath = join(flowlensDir, 'graph');
  if (!existsSync(graphPath)) {
    return { ...BASE, status: 'error', message: 'cannot init MCP: graph missing' };
  }

  // Graph-opening swap point for the graph service
  // (`openGraphStore(rootDir, { client: 'doctor' })`) at merge time.
  const graph = new LevelGraphStore();
  try {
    await graph.open(graphPath);
  } catch (err) {
    return openFailure(err);
  }

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
    return toolsResult(tools.map((t) => t.name));
  } catch (err) {
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

function openFailure(err: unknown): DiagnosticCheck {
  const msg = errorMessage(err);
  if (/lock/i.test(msg)) {
    return {
      ...BASE,
      status: 'warning',
      message: 'graph is in use by another FlowLens process (serve/canvas/watch?) — MCP not verified',
      details: msg,
    };
  }
  return { ...BASE, status: 'error', message: `MCP init would fail: ${msg}` };
}

function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: unknown }).cause;
  return cause instanceof Error ? `${err.message} (${cause.message})` : err.message;
}
