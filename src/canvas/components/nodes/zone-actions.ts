/**
 * What a zone chip / card can do, provided by the canvas (which knows the
 * open container): toggle expansion and open the context menu.
 */
import { createContext, useContext } from 'react';

export interface ZoneActions {
  /** Expand or collapse a zone item (remembered per project and container). */
  toggle: (itemId: string, expanded: boolean) => void;
  /** Right-click menu for a zone or file node. */
  openMenu: (nodeId: string, x: number, y: number) => void;
}

const NOOP: ZoneActions = { toggle: () => undefined, openMenu: () => undefined };

export const ZoneActionsContext = createContext<ZoneActions>(NOOP);
export const useZoneActions = (): ZoneActions => useContext(ZoneActionsContext);
