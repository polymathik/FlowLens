/** FlowContext for MCP tools: built once per graph load and cached on the GraphView. */
import type { ServerDependencies } from '../contracts/mcp/server.js';
import { createFlowContext, loadPackages, type FlowContext } from '../flow/context.js';
import { FlowGraph } from '../flow/graph.js';
import { buildCanvasUrl } from '../contracts/canvas-links.js';
import { FLOW_LINK_KIND, type EntryPoint } from '../contracts/flow.js';
import { readDaemonInfo } from '../service/daemon-info.js';
import { projectIdFor } from './tool-runtime.js';
import type { GraphView } from './graph-view.js';

export function flowContextFor(deps: ServerDependencies, view: GraphView): Promise<FlowContext> {
  return view.cached('flow:context', async () => {
    const [unresolved, ws] = await Promise.all([
      deps.graph.getUnresolvedRelations?.() ?? Promise.resolve([]),
      loadPackages(deps.graph, deps.rootDir),
    ]);
    const graph = new FlowGraph({ entities: view.nodes, relations: view.edges, unresolved });
    return createFlowContext(graph, { rootDir: deps.rootDir, ...ws, log: (l) => process.stderr.write(`${l}\n`) });
  });
}

/** `#/p/<id>/map/flow/<entityId>?depth=N[&span=a-b]` — the (future) Flow view of a trace. */
export function flowCanvasUrl(root: EntryPoint, depth: number, deps: Pick<ServerDependencies, 'flowlensDir'>): string {
  return buildCanvasUrl({
    kind: FLOW_LINK_KIND, identifier: root.entity_id, projectId: projectIdFor(deps), daemonPort: readDaemonInfo()?.port,
    params: { depth, ...(root.span ? { span: `${root.span.line_start}-${root.span.line_end}` } : {}) },
  });
}
