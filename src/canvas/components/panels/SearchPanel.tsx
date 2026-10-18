/**
 * Search palette (toolbar button or Cmd/Ctrl+K). Fuzzy-matches symbol names
 * and qualified names; choosing a result opens the symbol's container
 * (folders → file → class), selects it and centres it once laid out.
 * Arrow keys move through results, Enter opens, Escape closes.
 */
import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Entity } from '../../api/graph-client';
import type { Hierarchy } from '../../../contracts/hierarchy.js';
import { useCanvasStore } from '../../store/canvas-store';
import { searchEntities } from '../../utils/fuzzy-search';
import { targetForEntity } from '../../utils/navigation';
import { EntityIcon } from '../shared/EntityIcon';
import { COLORS } from '../shared/ui';

export function SearchPanel({ entities, hierarchy }: { entities: Entity[]; hierarchy: Hierarchy }) {
  const open = useCanvasStore((s) => s.searchOpen);
  const setOpen = useCanvasStore((s) => s.setSearchOpen);
  const query = useCanvasStore((s) => s.searchQuery);
  const setQuery = useCanvasStore((s) => s.setSearch);
  const navigateTo = useCanvasStore((s) => s.navigateTo);
  const deferred = useDeferredValue(query);
  const results = useMemo(() => searchEntities(entities, deferred), [entities, deferred]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);
  useEffect(() => setActive(0), [deferred]);

  if (!open) return null;

  const choose = (entity: Entity) => {
    const target = targetForEntity(hierarchy, entity);
    if (target) navigateTo(target);
    setOpen(false);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      choose(results[active].entity);
    }
  };

  return (
    <div
      onClick={() => setOpen(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(15,23,42,0.18)' }}
    >
      <div
        role="dialog"
        aria-label="Search symbols"
        data-testid="search-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: '16%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(520px, calc(100vw - 32px))',
          background: COLORS.surface,
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(15,23,42,0.25)',
          overflow: 'hidden',
        }}
      >
        <input
          ref={inputRef}
          data-testid="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder="Search symbols — e.g. usrSvc finds UserService"
          style={{ width: '100%', padding: '14px 16px', border: 'none', borderBottom: `1px solid ${COLORS.border}`, fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
        />
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {results.map(({ entity }, i) => (
            <div
              key={entity.id}
              data-testid="search-result"
              data-entity-id={entity.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(entity)}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: '8px 16px',
                cursor: 'pointer',
                background: i === active ? COLORS.accentSoft : 'transparent',
              }}
            >
              <EntityIcon kind={entity.kind} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 550, fontSize: 13 }}>{entity.name}</div>
                <div style={{ fontSize: 11, color: COLORS.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {entity.kind} · {entity.file}
                </div>
              </div>
            </div>
          ))}
          {query.trim() && results.length === 0 && (
            <div style={{ padding: '12px 16px', color: COLORS.faint }}>No symbols match “{query}”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
