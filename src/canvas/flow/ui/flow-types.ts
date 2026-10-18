/** React Flow node and edge type registries of the flow view (module-level: stable identities). */
import { FlowCardNode } from './FlowCardNode';
import { FlowEdge } from './FlowEdge';
import { FlowLaneNode } from './FlowLaneNode';

export const flowNodeTypes = { flowCard: FlowCardNode, flowLane: FlowLaneNode };
export const flowEdgeTypes = { flowHop: FlowEdge };
