/** React Flow node type registry (keys match `CanvasNodeType`). */
import { ConfigNode, FolderNode, ScopeNode } from './ContainerNodes';
import { FileNode } from './FileNode';
import { ZoneNode } from './ZoneNode';
import { EntityNode } from './EntityNode';
import { PortalNode } from './PortalNode';

export const nodeTypes = {
  zone: ZoneNode,
  package: FolderNode,
  folder: FolderNode,
  config: ConfigNode,
  file: FileNode,
  entity: EntityNode,
  scope: ScopeNode,
  portal: PortalNode,
};
