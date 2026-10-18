/**
 * What the card and edge components may ask of Flow mode, without carrying callbacks in the node data
 * (the data stays plain, so layouts and tests compare it by value).
 */
import { createContext, useContext } from 'react';

export interface FlowUi {
  /** Open / close the list of alternatives of an ambiguous call. */
  toggleCandidates: (cardId: string) => void;
  /** An alternative was chosen: select it when it is in the picture, otherwise trace from it. */
  pickCandidate: (candidate: { id: string; inTrace: boolean }) => void;
}

const none: FlowUi = { toggleCandidates: () => undefined, pickCandidate: () => undefined };

export const FlowUiContext = createContext<FlowUi>(none);
export const useFlowUi = (): FlowUi => useContext(FlowUiContext);
