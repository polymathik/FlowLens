/**
 * Light / dark theme. Default follows the OS (`prefers-color-scheme`); the
 * tab bar toggle pins light or dark (remembered per browser, best effort).
 * The choice is written to `<html data-theme>`, which styles/tokens.css reads.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { create } from 'zustand';

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'flowlens.explorer.theme';

function readPref(): ThemePreference {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export const useThemeStore = create<{ pref: ThemePreference; cycle: () => void }>((set, get) => ({
  pref: typeof window === 'undefined' ? 'system' : readPref(),
  cycle: () => {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    const pref = order[(order.indexOf(get().pref) + 1) % order.length];
    try {
      window.localStorage.setItem(KEY, pref);
    } catch {
      /* not remembered */
    }
    set({ pref });
  },
}));

const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

function useSystemDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = media();
      m?.addEventListener('change', cb);
      return () => m?.removeEventListener('change', cb);
    },
    () => Boolean(media()?.matches),
    () => false,
  );
}

/** Resolved mode ('light' | 'dark') for components that need it (React Flow). */
export function useColorMode(): 'light' | 'dark' {
  const pref = useThemeStore((s) => s.pref);
  const systemDark = useSystemDark();
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

/** Mirrors the resolved mode onto <html data-theme>. Mount once in the shell. */
export function useApplyTheme(): 'light' | 'dark' {
  const mode = useColorMode();
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);
  return mode;
}
