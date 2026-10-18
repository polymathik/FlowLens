/**
 * Live preview of a rules draft: debounced POST to /architecture/preview
 * (validates and computes violations without saving). Publishes the preview
 * violations to the store so the "Rule breaks" overlay reflects the draft.
 */
import { useEffect, useState } from 'react';
import type { ArchitectureConfig } from '../../../../contracts/architecture.js';
import type { ArchitectureViolation } from '../../../../contracts/analysis/architecture.js';
import type { ConfigIssue } from '../../../../contracts/canvas/index.js';
import { ApiError } from '../../../api/graph-client';
import { useGraphClient } from '../../explorer/project-context';
import { useCanvasStore } from '../../../store/canvas-store';

export const PREVIEW_DEBOUNCE_MS = 350;

export interface RulesPreview {
  violations: ArchitectureViolation[];
  issues: ConfigIssue[];
  loading: boolean;
}

export function useRulesPreview(draft: ArchitectureConfig | null, dirty: boolean): RulesPreview {
  const setPreviewViolations = useCanvasStore((s) => s.setPreviewViolations);
  const { previewArchitecture } = useGraphClient();
  const [state, setState] = useState<RulesPreview>({ violations: [], issues: [], loading: false });

  useEffect(() => {
    if (!draft) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      previewArchitecture(draft, controller.signal)
        .then((res) => {
          setState({ violations: res.violations, issues: [], loading: false });
          setPreviewViolations(dirty ? res.violations : null);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          const issues = err instanceof ApiError && err.issues.length ? err.issues : [{ path: '', message: String(err.message ?? err) }];
          setState({ violations: [], issues, loading: false });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, dirty, setPreviewViolations, previewArchitecture]);

  // Leaving the editor drops the unsaved preview from the overlay.
  useEffect(() => () => setPreviewViolations(null), [setPreviewViolations]);

  return state;
}
