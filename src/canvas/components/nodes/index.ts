/** React Flow node type registry (keys match `CanvasNodeType`). */
import { FileNode, ModuleNode, SystemNode } from './ContainerNodes';
import { EntityNode } from './EntityNode';

export const nodeTypes = {
  system: SystemNode,
  module: ModuleNode,
  file: FileNode,
  entity: EntityNode,
};
