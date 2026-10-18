/**
 * List input rendered as removable chips. Enter (or the + button) adds the
 * typed value as one item — commas are kept, so brace globs such as
 * `src/{api,web}/**` survive. Pasting several lines adds one chip per line.
 */
import React, { useState } from 'react';
import { COLORS, input } from '../../shared/ui';

interface ChipInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  testId?: string;
}

export function ChipInput({ values, onChange, placeholder, testId }: ChipInputProps) {
  const [text, setText] = useState('');

  const add = (raw: string[]) => {
    const items = raw.map((s) => s.trim()).filter((s) => s && !values.includes(s));
    if (items.length) onChange([...values, ...items]);
    setText('');
  };

  return (
    <div data-testid={testId}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: values.length ? 4 : 0 }}>
        {values.map((v) => (
          <span
            key={v}
            data-testid="chip"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 4px 1px 8px', borderRadius: 10, background: '#f1f5f9', border: `1px solid ${COLORS.border}`, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}
          >
            {v}
            <button
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: COLORS.faint, padding: '0 2px' }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add([text]);
            } else if (e.key === 'Backspace' && !text && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (pasted.includes('\n')) {
              e.preventDefault();
              add(pasted.split(/\r?\n/));
            }
          }}
          style={{ ...input, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}
        />
        <button aria-label="Add" onClick={() => add([text])} disabled={!text.trim()} style={{ ...input, width: 30, cursor: 'pointer', padding: 0 }}>
          +
        </button>
      </div>
    </div>
  );
}
