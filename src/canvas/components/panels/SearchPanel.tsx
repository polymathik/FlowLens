/**
 * Search panel with results dropdown.
 * Opened via Cmd/Ctrl+K shortcut. Searches entities by name or qualified_name,
 * then pans/focuses the canvas on the selected result.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useCanvasStore } from '../../store/canvas-store';
import { useSearch } from '../../hooks/useSearch';
import type { Entity } from '../../api/graph-client';

export function SearchPanel({ entities }: { entities: Entity[] }) {
  const [open, setOpen] = useState(false);
  const searchQuery = useCanvasStore((s) => s.searchQuery);
  const setSearch = useCanvasStore((s) => s.setSearch);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const { fitView } = useReactFlow();
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useSearch(entities, searchQuery);

  // Cmd/Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSelect = (entity: Entity) => {
    selectNode(entity.id);
    setOpen(false);
    setSearch('');
    // Pan to the node
    fitView({ nodes: [{ id: entity.id }], padding: 0.5, duration: 500 });
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '20%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100,
        width: 400,
        backgroundColor: 'white',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        overflow: 'hidden',
      }}
    >
      <input
        ref={inputRef}
        value={searchQuery}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search entities... (Cmd+K)"
        style={{
          width: '100%',
          padding: '12px 16px',
          border: 'none',
          borderBottom: '1px solid #e2e8f0',
          fontSize: 14,
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      {results.length > 0 && (
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {results.map((e) => (
            <div
              key={e.id}
              onClick={() => handleSelect(e)}
              style={{
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: 13,
                borderBottom: '1px solid #f1f5f9',
              }}
              onMouseEnter={(ev) => {
                (ev.currentTarget as HTMLElement).style.backgroundColor =
                  '#f8fafc';
              }}
              onMouseLeave={(ev) => {
                (ev.currentTarget as HTMLElement).style.backgroundColor =
                  'white';
              }}
            >
              <div style={{ fontWeight: 500 }}>{e.name}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                {e.kind} &middot; {e.file}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
