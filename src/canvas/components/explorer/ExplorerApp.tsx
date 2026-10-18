/**
 * Explorer shell: checks the browser session, keeps the hash and tabs in
 * sync, streams per-project change events, and shows Home or the active
 * project tab.
 */
import React, { useEffect, useState } from 'react';
import { fetchSession } from '../../api/explorer-client';
import { onSignedOut } from '../../api/http';
import { useExplorerStore } from '../../store/explorer-store';
import { HomeView } from './HomeView';
import { ProjectTab } from './ProjectTab';
import { TabBar } from './TabBar';
import { useApplyTheme } from './theme';
import { useExplorerRoute } from './useExplorerRoute';
import { useProjectEvents } from './useProjectEvents';
import { useProjects } from './useProjects';

export function ExplorerApp() {
  useApplyTheme();
  const [session, setSession] = useState<'checking' | 'ok' | 'signed-out' | 'offline'>('checking');
  const signedOut = useExplorerStore((s) => s.signedOut);
  const setSignedOut = useExplorerStore((s) => s.setSignedOut);

  useEffect(() => {
    const off = onSignedOut(() => setSignedOut(true));
    fetchSession().then(
      () => setSession('ok'),
      (err: { status?: number }) => setSession(err?.status === 401 ? 'signed-out' : 'offline'),
    );
    return () => {
      off();
    };
  }, [setSignedOut]);

  if (session === 'checking') return <div className="fl-app fl-center">Opening FlowLens…</div>;
  if (session !== 'ok' || signedOut) return <SignInNeeded offline={session === 'offline'} />;
  return <SignedIn />;
}

function SignedIn() {
  const { projects, error, byId } = useProjects();
  const { route, stamp } = useExplorerRoute(projects);
  const active = useExplorerStore((s) => s.activeTab);
  const openTabs = useExplorerStore((s) => s.openTabs);
  useProjectEvents(openTabs, true);

  return (
    <div className="fl-app" data-testid="explorer" data-active-tab={active}>
      <TabBar byId={byId} />
      <main className="fl-main">
        {active === 'home' ? (
          <HomeView projects={projects} error={error} />
        ) : (
          <ProjectTab
            key={active}
            projectId={active}
            project={byId(active)}
            route={route.tab === 'project' && route.projectId === active ? route : { tab: 'project', projectId: active, view: 'health' }}
            routeStamp={stamp}
          />
        )}
      </main>
    </div>
  );
}

function SignInNeeded({ offline }: { offline: boolean }) {
  return (
    <div className="fl-app fl-center" data-testid="sign-in-needed">
      <div className="fl-notice">
        <h2>{offline ? 'FlowLens is not running' : 'Open FlowLens from your terminal'}</h2>
        <p>
          {offline
            ? 'This page could not reach the FlowLens background service on this computer.'
            : 'For your safety this page only works when opened through FlowLens, and the session ends when FlowLens restarts.'}
        </p>
        <p>
          In your project folder, run <code>flowlens canvas</code>. It opens this page again, signed in.
        </p>
      </div>
    </div>
  );
}
