/**
 * What the stage shows instead of (or over) a picture: the loading skeleton, and the error states of the
 * trace request with a way forward each: not found (did-you-mean chips), ambiguous (candidate picker),
 * a failed request (retry; the daemon may be re-indexing), and a failed load of an inline handler root.
 */
import React from 'react';
import type { FlowSpec } from '../../../contracts/canvas/index.js';
import { FlowApiError } from '../api/flow-client';
import { button, buttonActive } from '../../components/shared/ui';

export function FlowSkeleton() {
  return (
    <div className="fl-flow-skeleton" data-testid="flow-loading" aria-busy="true" aria-label="Loading the flow">
      {[0, 1, 2].map((r) => (
        <div key={r}>
          {[0, 1, 2].slice(0, r === 0 ? 3 : r + 1).map((c) => <i key={c} />)}
        </div>
      ))}
    </div>
  );
}

export interface FlowErrorProps {
  error: Error;
  spec: FlowSpec;
  onRetry: () => void;
  /** Trace this entity id / label instead. */
  onPick: (id: string, label?: string) => void;
  onPicker: () => void;
  onSearch: () => void;
  onExit: () => void;
}

function Actions({ onRetry, onPicker, onSearch, onExit }: Pick<FlowErrorProps, 'onRetry' | 'onPicker' | 'onSearch' | 'onExit'>) {
  return (
    <div className="fl-flow-actions">
      <button type="button" style={buttonActive} data-testid="flow-retry" onClick={onRetry}>Try again</button>
      <button type="button" style={button} data-testid="flow-error-picker" onClick={onPicker}>Choose an entry point</button>
      <button type="button" style={button} data-testid="flow-error-search" onClick={onSearch}>Search for a function</button>
      <button type="button" style={button} data-testid="flow-error-exit" onClick={onExit}>Exit flow</button>
    </div>
  );
}

export function FlowError(props: FlowErrorProps) {
  const { error, spec, onPick } = props;
  const api = error instanceof FlowApiError ? error : null;
  if (api?.code === 'not_found') {
    return (
      <div className="fl-flow-state" data-testid="flow-error" data-code="not_found">
        <div>
          <h3>Nothing to trace for “{spec.label ?? spec.id}”</h3>
          <p>{api.message}</p>
          {api.suggestions.length > 0 && (
            <>
              <p>Did you mean:</p>
              <div className="fl-flow-suggest" data-testid="flow-suggestions">
                {api.suggestions.map((s) => <button key={s} type="button" onClick={() => onPick(s, s)}>{s}</button>)}
              </div>
            </>
          )}
          <Actions {...props} />
        </div>
      </div>
    );
  }
  if (api?.code === 'ambiguous') {
    return (
      <div className="fl-flow-state" data-testid="flow-error" data-code="ambiguous">
        <div>
          <h3>More than one match for “{spec.label ?? spec.id}”</h3>
          <p>Pick the one you mean:</p>
          <div className="fl-flow-suggest" data-testid="flow-ambiguous" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            {api.candidates.map((c) => (
              <button key={c.id} type="button" data-testid="flow-ambiguous-candidate" onClick={() => onPick(c.id, c.qualified_name)} style={{ textAlign: 'left' }}>
                {c.qualified_name} <span style={{ opacity: 0.7 }}>· {c.file}:{c.line}</span>
              </button>
            ))}
          </div>
          <Actions {...props} />
        </div>
      </div>
    );
  }
  return (
    <div className="fl-flow-state" data-testid="flow-error" data-code={api?.code ?? 'error'}>
      <div>
        <h3>Could not load the flow</h3>
        <p>{error.message || 'The request failed.'}</p>
        <p>If the project is being re-indexed right now, wait a moment and try again.</p>
        <Actions {...props} />
      </div>
    </div>
  );
}
