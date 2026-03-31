/**
 * Architecture rule editor panel.
 * Allows viewing and editing architecture layers and their access rules.
 * Displays violation counts and supports CRUD operations on layers.
 */
import React, { useState, useEffect } from 'react';
import { fetchArchitecture, fetchViolations } from '../../api/graph-client';

interface LayerConfig {
  name: string;
  include?: { patterns: string[] };
  may_only_access?: string[];
  must_not_access?: string[];
}

interface ArchConfig {
  layers: LayerConfig[];
  [key: string]: unknown;
}

export function ArchitectureEditor({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<ArchConfig | null>(null);
  const [violations, setViolations] = useState<unknown[]>([]);
  const [editing, setEditing] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      fetchArchitecture().then((data) => setConfig(data as ArchConfig));
      fetchViolations().then(setViolations);
    }
  }, [open]);

  if (!open || !config) return null;

  const saveConfig = async () => {
    await fetch('/api/architecture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const v = await fetchViolations();
    setViolations(v);
  };

  const addLayer = () => {
    setConfig({
      ...config,
      layers: [
        ...(config.layers ?? []),
        { name: 'New Layer', include: { patterns: [] } },
      ],
    });
  };

  const deleteLayer = (idx: number) => {
    const layers = [...config.layers];
    layers.splice(idx, 1);
    setConfig({ ...config, layers });
  };

  const updateLayer = (idx: number, field: string, value: unknown) => {
    const layers = [...config.layers];
    layers[idx] = { ...layers[idx], [field]: value };
    setConfig({ ...config, layers });
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 40,
        right: 8,
        zIndex: 20,
        width: 350,
        maxHeight: '80vh',
        overflowY: 'auto',
        backgroundColor: 'white',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        fontSize: 12,
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 14 }}>
          Architecture Layers
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={addLayer}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid #cbd5e1',
              cursor: 'pointer',
              backgroundColor: 'transparent',
            }}
          >
            + Add
          </button>
          <button
            onClick={saveConfig}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid #22c55e',
              color: '#22c55e',
              cursor: 'pointer',
              backgroundColor: 'transparent',
            }}
          >
            Save
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid #cbd5e1',
              cursor: 'pointer',
              backgroundColor: 'transparent',
            }}
          >
            x
          </button>
        </div>
      </div>
      {violations.length > 0 && (
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: '#fef2f2',
            color: '#ef4444',
            fontSize: 11,
          }}
        >
          {violations.length} violations detected
        </div>
      )}
      {(config.layers ?? []).map((layer, idx) => (
        <LayerRow
          key={idx}
          layer={layer}
          isEditing={editing === idx}
          onEdit={() => setEditing(idx)}
          onDoneEdit={() => setEditing(null)}
          onUpdate={(field, value) => updateLayer(idx, field, value)}
          onDelete={() => deleteLayer(idx)}
        />
      ))}
    </div>
  );
}

/** Individual layer row — extracted to keep ArchitectureEditor concise. */
function LayerRow({
  layer,
  isEditing,
  onEdit,
  onDoneEdit,
  onUpdate,
  onDelete,
}: {
  layer: LayerConfig;
  isEditing: boolean;
  onEdit: () => void;
  onDoneEdit: () => void;
  onUpdate: (field: string, value: unknown) => void;
  onDelete: () => void;
}) {
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: 4,
    marginBottom: 4,
    border: '1px solid #cbd5e1',
    borderRadius: 4,
    fontSize: 11,
    boxSizing: 'border-box',
  };

  if (isEditing) {
    return (
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #f1f5f9' }}>
        <input
          value={layer.name}
          onChange={(e) => onUpdate('name', e.target.value)}
          style={{ ...inputStyle, fontSize: 12 }}
        />
        <input
          value={(layer.include?.patterns ?? []).join(', ')}
          onChange={(e) =>
            onUpdate('include', {
              ...layer.include,
              patterns: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="Patterns (comma-separated)"
          style={inputStyle}
        />
        <input
          value={(layer.may_only_access ?? []).join(', ')}
          onChange={(e) =>
            onUpdate(
              'may_only_access',
              e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          placeholder="May only access (comma-separated)"
          style={inputStyle}
        />
        <button
          onClick={onDoneEdit}
          style={{ fontSize: 10, cursor: 'pointer' }}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid #f1f5f9' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 600 }}>{layer.name}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={onEdit}
            style={{
              fontSize: 10,
              cursor: 'pointer',
              border: 'none',
              background: 'none',
              color: '#3b82f6',
            }}
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            style={{
              fontSize: 10,
              cursor: 'pointer',
              border: 'none',
              background: 'none',
              color: '#ef4444',
            }}
          >
            Delete
          </button>
        </div>
      </div>
      {layer.include?.patterns && (
        <div style={{ fontSize: 10, color: '#94a3b8' }}>
          Patterns: {layer.include.patterns.join(', ')}
        </div>
      )}
      {layer.may_only_access && (
        <div style={{ fontSize: 10, color: '#94a3b8' }}>
          May access: {layer.may_only_access.join(', ')}
        </div>
      )}
      {layer.must_not_access && (
        <div style={{ fontSize: 10, color: '#94a3b8' }}>
          Must not access: {layer.must_not_access.join(', ')}
        </div>
      )}
    </div>
  );
}
