/**
 * Tab bar: Home first, then one tab per open project, then "+" to open a
 * registered project. WAI-ARIA tabs pattern: arrow keys move between tabs,
 * Home/End jump, Enter/Space activate, Delete closes a project tab.
 */
import React, { useRef, useState } from 'react';
import type { ProjectDetail } from '../../../contracts/service.js';
import { useExplorerStore } from '../../store/explorer-store';
import { tabHash } from '../../router/explorer-route';
import { navigate } from '../../router/navigate';
import { LogoMark } from '../shared/LogoMark';
import { ProjectPicker } from './ProjectPicker';
import { useThemeStore } from './theme';

const THEME_LABEL = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' } as const;

export function TabBar({ byId }: { byId: (id: string) => ProjectDetail | null }) {
  const openTabs = useExplorerStore((s) => s.openTabs);
  const active = useExplorerStore((s) => s.activeTab);
  const views = useExplorerStore((s) => s.views);
  const revisions = useExplorerStore((s) => s.revisions);
  const closeTab = useExplorerStore((s) => s.closeTab);
  const theme = useThemeStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const tabs = ['home', ...openTabs];

  const activate = (tab: string) => navigate(tabHash(tab, views[tab]));
  const close = (tab: string) => navigate(tabHash(closeTab(tab), views[tab]));

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const move = (j: number) => refs.current[(j + tabs.length) % tabs.length]?.focus();
    if (e.key === 'ArrowRight') move(i + 1);
    else if (e.key === 'ArrowLeft') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(tabs.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') activate(tabs[i]);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && tabs[i] !== 'home') close(tabs[i]);
    else return;
    e.preventDefault();
  };

  return (
    <nav className="fl-tabbar" aria-label="Projects">
      <span className="fl-brand">
        <LogoMark size={22} />
        <span className="fl-brand-name">FlowLens</span>
      </span>
      <div className="fl-tabs" role="tablist" aria-label="Open projects">
        {tabs.map((tab, i) => {
          const p = tab === 'home' ? null : byId(tab);
          const name = tab === 'home' ? 'Home' : (p?.name ?? 'Unknown project');
          const selected = tab === active;
          return (
            <div
              key={tab}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              id={`tab-${tab}`}
              aria-selected={selected}
              aria-controls="fl-tabpanel"
              tabIndex={selected ? 0 : -1}
              data-testid={tab === 'home' ? 'tab-home' : `tab-${tab}`}
              data-revision={revisions[tab] ?? 0}
              className={`fl-tab ${tab === 'home' ? 'fl-tab-home' : ''} ${p?.status === 'missing' ? 'fl-tab-missing' : ''}`}
              onClick={() => activate(tab)}
              onKeyDown={(e) => onKey(e, i)}
              title={p ? `${p.name} — ${p.root}` : undefined}
            >
              <span className="fl-tab-label">{name}</span>
              {tab !== 'home' && (
                <button
                  type="button"
                  className="fl-tab-close"
                  tabIndex={-1}
                  aria-label={`Close ${name}`}
                  data-testid={`close-${tab}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    close(tab);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ position: 'relative', display: 'flex' }}>
        <button
          type="button"
          className="fl-tab-add"
          aria-label="Open a project"
          aria-expanded={pickerOpen}
          aria-haspopup="dialog"
          data-testid="tab-add"
          onClick={() => setPickerOpen((v) => !v)}
        >
          +
        </button>
        {pickerOpen && <ProjectPicker onClose={() => setPickerOpen(false)} />}
      </div>
      <div className="fl-tabbar-end">
        <button type="button" className="fl-quiet-btn" onClick={theme.cycle} data-testid="theme-toggle">
          {THEME_LABEL[theme.pref]}
        </button>
      </div>
    </nav>
  );
}
