/**
 * What `flowlens canvas` needs from the daemon: make sure it runs, register
 * the current project (when it has `.flowlens/`), and mint a one-time
 * sign-in URL that lands on that project's Health screen (or Home).
 */
import { existsSync } from 'node:fs';
import { EXPLORER_ROUTES, type AuthCodeRequest, type AuthCodeResponse } from '../contracts/canvas/explorer.js';
import type { ProjectWithStatus } from '../contracts/projects.js';
import { SERVICE_ROUTES } from '../contracts/service.js';
import { canonicalRoot, projectFlowlensDir } from '../projects/paths.js';
import { connectDaemon } from './autostart.js';
import type { DaemonClient } from './client.js';

export interface ExplorerLaunch {
  client: DaemonClient;
  /** The current project, when the working directory has `.flowlens/`. */
  project: ProjectWithStatus | null;
  /** Hash route the browser lands on. */
  redirect: string;
  /** One-time sign-in URL on the daemon (`/auth?t=…`). */
  url: string;
}

export function explorerRedirect(project: ProjectWithStatus | null): string {
  return project ? `#/p/${encodeURIComponent(project.id)}/health` : '#/home';
}

export async function mintSignInUrl(client: DaemonClient, redirect: string, ttlMs?: number): Promise<string> {
  const body: AuthCodeRequest = ttlMs === undefined ? { redirect } : { redirect, ttl_ms: ttlMs };
  const res = await client.request<AuthCodeResponse>('POST', EXPLORER_ROUTES.authCode, body);
  return res.url;
}

export async function prepareExplorer(
  cwd: string, o: { startTimeoutMs?: number; codeTtlMs?: number } = {},
): Promise<ExplorerLaunch> {
  const client = await connectDaemon({ timeoutMs: o.startTimeoutMs });
  let project: ProjectWithStatus | null = null;
  const root = canonicalRoot(cwd);
  if (existsSync(projectFlowlensDir(root))) {
    project = await client.request<ProjectWithStatus>('POST', SERVICE_ROUTES.resolve, { root, register: true });
  }
  const redirect = explorerRedirect(project);
  return { client, project, redirect, url: await mintSignInUrl(client, redirect, o.codeTtlMs) };
}
