/**
 * Home tab: a health card per registered project, worst first, so the
 * project that most needs attention is top-left. Missing projects sort
 * last (nothing to score). Clicking a card opens that project's Health.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { ProjectDetail } from '../../../contracts/service.js';
import { fetchHealthSummary } from '../../api/explorer-client';
import { useExplorerStore } from '../../store/explorer-store';
import { tabHash } from '../../router/explorer-route';
import { navigate } from '../../router/navigate';
import { ProjectCard } from './ProjectCard';
import { sortWorstFirst, type SummaryState } from './home-sort';

export function HomeView({ projects, error }: { projects: ProjectDetail[] | null; error: string | null }) {
  const revisions = useExplorerStore((s) => s.revisions);
  const [summaries, setSummaries] = useState<SummaryState>({});
  const revKey = (projects ?? []).map((p) => `${p.id}:${p.status}:${revisions[p.id] ?? 0}:${p.last_indexed}`).join('|');

  useEffect(() => {
    let cancelled = false;
    for (const p of projects ?? []) {
      if (p.status !== 'ok') continue;
      fetchHealthSummary(p.id).then(
        (s) => !cancelled && setSummaries((prev) => ({ ...prev, [p.id]: s })),
        (err: unknown) => !cancelled && setSummaries((prev) => ({ ...prev, [p.id]: { error: err instanceof Error ? err.message : String(err) } })),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [revKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => sortWorstFirst(projects ?? [], summaries), [projects, summaries]);

  return (
    <div className="fl-scroll" id="fl-tabpanel" role="tabpanel" aria-labelledby="tab-home">
      <div className="fl-page">
        <header className="fl-page-head">
          <h1>Your projects</h1>
          <p>How healthy each project's code looks, with the one that needs the most attention first. Open a project to see what to fix and why.</p>
        </header>
        {error && !projects && <p className="fl-banner">Could not load your projects: {error}</p>}
        {projects && projects.length === 0 && <EmptyHome />}
        {sorted.length > 0 && (
          <ul className="fl-cards" data-testid="home-cards">
            {sorted.map((p) => (
              <li key={p.id}>
                <ProjectCard project={p} summary={summaries[p.id]} onOpen={() => navigate(tabHash(p.id))} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyHome() {
  return (
    <section className="fl-empty" data-testid="home-empty">
      <h2>No projects yet</h2>
      <p>FlowLens adds a project the first time you set it up there:</p>
      <ol>
        <li>Open a terminal in your project folder.</li>
        <li>
          Run <code>flowlens init</code>. It maps the code (nothing leaves your machine).
        </li>
        <li>
          Run <code>flowlens canvas</code> to open it here.
        </li>
      </ol>
    </section>
  );
}
