/**
 * Explorer shell state: open tabs (persisted, best effort), the last
 * sub-view per project, per-project graph revisions pushed over SSE, and
 * the signed-out flag. Canvas state per project lives in project-stores.ts.
 */
import { create } from 'zustand';
import { TABS_STORAGE_KEY, type PersistedTabs, type ProjectView } from '../../contracts/canvas/index.js';
import { dropProjectStore } from './project-stores';

export interface ExplorerState {
  openTabs: string[];
  /** 'home' or a project id. */
  activeTab: string;
  views: Record<string, ProjectView>;
  /** Bumped on every `graph-changed` event of a project. */
  revisions: Record<string, number>;
  signedOut: boolean;

  openTab: (id: string) => void;
  closeTab: (id: string) => string;
  setActive: (tab: string) => void;
  setView: (id: string, view: ProjectView) => void;
  bumpRevision: (id: string) => void;
  setSignedOut: (v: boolean) => void;
}

export function loadPersistedTabs(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): string[] {
  try {
    const raw = storage?.getItem(TABS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PersistedTabs>;
    return parsed.version === 1 && Array.isArray(parsed.open)
      ? parsed.open.filter((x): x is string => typeof x === 'string').slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

export function savePersistedTabs(open: string[], storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(TABS_STORAGE_KEY, JSON.stringify({ version: 1, open } satisfies PersistedTabs));
  } catch {
    /* private mode / blocked storage: tabs just aren't remembered */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  openTabs: loadPersistedTabs(),
  activeTab: 'home',
  views: {},
  revisions: {},
  signedOut: false,

  openTab: (id) => {
    if (get().openTabs.includes(id)) return;
    const openTabs = [...get().openTabs, id];
    savePersistedTabs(openTabs);
    set({ openTabs });
  },
  /** Close a tab; returns the tab that should become active. */
  closeTab: (id) => {
    const { openTabs, activeTab } = get();
    const i = openTabs.indexOf(id);
    const next = openTabs.filter((t) => t !== id);
    savePersistedTabs(next);
    dropProjectStore(id);
    const nextActive = activeTab !== id ? activeTab : (next[i] ?? next[i - 1] ?? 'home');
    set({ openTabs: next, activeTab: nextActive });
    return nextActive;
  },
  setActive: (tab) => set((s) => (s.activeTab === tab ? s : { activeTab: tab })),
  setView: (id, view) => set((s) => (s.views[id] === view ? s : { views: { ...s.views, [id]: view } })),
  bumpRevision: (id) => set((s) => ({ revisions: { ...s.revisions, [id]: (s.revisions[id] ?? 0) + 1 } })),
  setSignedOut: (v) => set({ signedOut: v }),
}));
