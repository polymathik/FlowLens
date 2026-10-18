/**
 * A project's Health screen (the default view of a project tab): the grade
 * with what it means, how the score is made, caveats, and the ranked
 * findings with "Show on map" and "Copy fix prompt".
 */
import React from 'react';
import { fetchHealth, reportUrl } from '../../api/explorer-client';
import { navigate } from '../../router/navigate';
import { useExplorerStore } from '../../store/explorer-store';
import { formatRelativeTime } from '../../utils/format';
import { FindingCard } from './FindingCard';
import { showOnMapHash } from './health-nav';
import { CONFIDENCE_LABEL, VERDICT, gradeColor, plural } from './labels';
import { ScoreBreakdown } from './ScoreBreakdown';
import { useAsync } from './useProjects';

export function HealthView({ projectId }: { projectId: string }) {
  const revision = useExplorerStore((s) => s.revisions[projectId] ?? 0);
  const { data: report, error, loading } = useAsync(() => fetchHealth(projectId), [projectId, revision]);

  if (!report && loading) return <div className="fl-center">Checking this project's health…</div>;
  if (!report) return <div className="fl-center">Could not check this project: {error}</div>;

  const actionable = report.findings.filter((f) => f.severity !== 'info');
  const fyi = report.findings.filter((f) => f.severity === 'info');
  const showCaveats = report.confidence !== 'high' || report.caveats.length > 0;

  return (
    <div className="fl-scroll" data-testid="health-view" data-revision={revision}>
      <div className="fl-page">
        {showCaveats && (
          <div className="fl-banner" role="note" data-testid="health-caveats">
            <div>
              <strong>{CONFIDENCE_LABEL[report.confidence]}</strong>
              {report.caveats.length > 0 && (
                <ul>
                  {report.caveats.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <div className="fl-health">
          <aside className="fl-health-side">
            <section className="fl-grade-block" style={{ ['--grade' as string]: gradeColor(report.grade) }} data-testid="health-grade" data-grade={report.grade}>
              <span className="fl-grade-letter" aria-label={`Grade ${report.grade}`}>
                {report.grade}
              </span>
              <span className="fl-grade-score">
                {report.score}
                <small> / 100</small>
              </span>
              <span style={{ fontSize: 12, color: 'var(--fl-muted)' }}>
                {plural(report.stats.files, 'file')}, indexed {formatRelativeTime(report.graph.last_indexed)}
              </span>
              <p className="fl-verdict">{VERDICT[report.grade]}</p>
            </section>
            <ScoreBreakdown breakdown={report.breakdown} />
            <section className="fl-panel">
              <h3>Share or keep a copy</h3>
              <div className="fl-actions">
                <a className="fl-quiet-btn" href={reportUrl(projectId, 'html')} download data-testid="download-html">
                  Download report (HTML)
                </a>
                <a className="fl-quiet-btn" href={reportUrl(projectId, 'md')} download>
                  Markdown
                </a>
              </div>
            </section>
          </aside>
          <section aria-labelledby="fl-findings-title">
            <div className="fl-section-title">
              <h3 id="fl-findings-title">Fix these first</h3>
              <span>
                {report.total_findings > report.findings.length
                  ? `Top ${report.findings.length} of ${report.total_findings}`
                  : plural(report.total_findings, 'finding')}
              </span>
            </div>
            {actionable.length === 0 && <p className="fl-panel">Nothing risky found. Re-check after big changes.</p>}
            <ol className="fl-findings" data-testid="findings">
              {actionable.map((f) => (
                <FindingCard key={f.id} finding={f} onShowOnMap={() => navigate(showOnMapHash(projectId, f))} />
              ))}
            </ol>
            {fyi.length > 0 && (
              <>
                <div className="fl-section-title" style={{ marginTop: 24 }}>
                  <h3>Worth a look</h3>
                  <span>Not scored</span>
                </div>
                <ol className="fl-findings">
                  {fyi.map((f) => (
                    <FindingCard key={f.id} finding={f} onShowOnMap={() => navigate(showOnMapHash(projectId, f))} />
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
