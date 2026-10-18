/** React Flow node type registry (keys match `CanvasNodeType`). */
import { ConfigNode, FileNode, FolderNode, ScopeNode } from './ContainerNodes';
import { EntityNode } from './EntityNode';
import { PortalNode } from './PortalNode';

export const nodeTypes = {
  package: FolderNode,
  folder: FolderNode,
  config: ConfigNode,
  file: FileNode,
  entity: EntityNode,
  scope: ScopeNode,
  portal: PortalNode,
};
