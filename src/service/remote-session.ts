/**
 * RemoteSession — the connection state behind a `RemoteGraphStore`: the
 * daemon client, the resolved project, its leases (renewed in the
 * background) and SSE subscriptions.
 *
 * Recovery (`recover`), single-flight so concurrent failures share one:
 * - the daemon went away (connection error) → connect again (auto-starting
 *   a daemon), re-resolve the project, re-lease, re-subscribe;
 * - the project was removed from the registry (`not_found`, e.g. the
 *   explorer's "Remove from list") → re-resolve with `register: true` on the
 *   same daemon (the project gets its id back from `.flowlens/`), re-lease,
 *   re-subscribe.
 * Old leases are released first (best effort), so a transient connection
 * error never leaves a stale lease pinning the project until its TTL.
 */
import type { ProjectWithStatus } from '../contracts/projects.js';
import {
  routePath, SERVICE_ROUTES, type LeaseRequest, type LeaseResponse, type ServiceEvent,
} from '../contracts/service.js';
import { isConnectionError, type DaemonClient, type RequestOptions, type Subscription } from './client.js';
import { RemoteServiceError } from './errors.js';

export type Connect = () => Promise<DaemonClient>;

interface LeaseState {
  id: string;
  /** Project id the lease was taken on (changes when the project is re-registered). */
  projectId: string;
  req: LeaseRequest;
  timer: NodeJS.Timeout;
}

const LEASE_CALL_TIMEOUT_MS = 5_000;

/** True for errors after which `recover()` + one retry is safe. */
export function isRecoverable(err: unknown): boolean {
  return isConnectionError(err) || (err instanceof RemoteServiceError && err.code === 'not_found');
}

export class RemoteSession {
  client: DaemonClient | null = null;
  project: ProjectWithStatus | null = null;
  private recovering: Promise<void> | null = null;
  private leases: LeaseState[] = [];
  private subs: Array<{ onEvent: (e: ServiceEvent) => void; sub: Subscription }> = [];

  constructor(private readonly connect: Connect, private readonly root: string) {}

  requireOpen(): { client: DaemonClient; project: ProjectWithStatus } {
    if (!this.client || !this.project) throw new Error('RemoteGraphStore is not open');
    return { client: this.client, project: this.project };
  }

  /** Connect (when needed) and resolve/register the project root. */
  async attach(reconnect = true): Promise<void> {
    if (reconnect || !this.client) {
      this.client?.destroy();
      this.client = await this.connect();
    }
    this.project = await this.client.request<ProjectWithStatus>(
      'POST', SERVICE_ROUTES.resolve, { root: this.root, register: true },
    );
  }

  /** Recover after `err` (see module doc); rethrows errors that are not recoverable. */
  recover(err: unknown): Promise<void> {
    if (!isRecoverable(err)) return Promise.reject(err);
    this.recovering ??= this.doRecover(isConnectionError(err)).finally(() => { this.recovering = null; });
    return this.recovering;
  }

  private async doRecover(reconnect: boolean): Promise<void> {
    await this.releaseAll(this.leases, false);
    await this.attach(reconnect);
    for (const l of this.leases) await this.reacquire(l);
    const { client, project } = this.requireOpen();
    for (const s of this.subs) {
      s.sub.close();
      s.sub = client.subscribe(project.id, s.onEvent);
    }
  }

  async addLease(req: LeaseRequest): Promise<void> {
    const { client, project } = this.requireOpen();
    const res = await client.request<LeaseResponse>(
      'POST', routePath(SERVICE_ROUTES.leases, { id: project.id }), req,
    );
    const state = { id: res.lease_id, projectId: project.id, req } as LeaseState;
    state.timer = setInterval(() => void this.renew(state), Math.max(200, res.ttl_ms / 3));
    state.timer.unref();
    this.leases.push(state);
  }

  subscribe(onEvent: (e: ServiceEvent) => void): Subscription {
    const { client, project } = this.requireOpen();
    const entry = { onEvent, sub: client.subscribe(project.id, onEvent) };
    this.subs.push(entry);
    return {
      close: () => {
        entry.sub.close();
        this.subs = this.subs.filter((x) => x !== entry);
      },
    };
  }

  async close(): Promise<void> {
    for (const s of this.subs) s.sub.close();
    this.subs = [];
    const leases = this.leases;
    this.leases = [];
    await this.releaseAll(leases, true);
    this.client?.destroy();
    this.client = null;
  }

  request<T>(method: string, path: string, body: unknown, o: RequestOptions): Promise<T> {
    return this.requireOpen().client.request<T>(method, path, body, o);
  }

  /* ---------------- internals ---------------- */

  /** DELETE each lease (best effort); `stopRenewal` also clears the timers. */
  private async releaseAll(leases: LeaseState[], stopRenewal: boolean): Promise<void> {
    for (const l of leases) {
      if (stopRenewal) clearInterval(l.timer);
      await this.leaseCall('DELETE', l).catch(() => undefined);
    }
  }

  private async renew(l: LeaseState): Promise<void> {
    if (this.recovering) return;
    try {
      await this.leaseCall('PUT', l);
    } catch (err) {
      try {
        if (isConnectionError(err)) await this.recover(err);
        else if (err instanceof RemoteServiceError && err.code === 'not_found') {
          // Lease expired → take a new one; project removed too → re-register (recover).
          await this.reacquire(l).catch((e: unknown) => this.recover(e));
        }
      } catch { /* try again next tick */ }
    }
  }

  private async reacquire(l: LeaseState): Promise<void> {
    const { client, project } = this.requireOpen();
    const res = await client.request<LeaseResponse>(
      'POST', routePath(SERVICE_ROUTES.leases, { id: project.id }), l.req,
    );
    l.id = res.lease_id;
    l.projectId = project.id;
  }

  private leaseCall(method: 'PUT' | 'DELETE', l: LeaseState): Promise<unknown> {
    const client = this.client;
    if (!client) return Promise.reject(new Error('RemoteGraphStore is not open'));
    return client.request(method, routePath(SERVICE_ROUTES.lease, { id: l.projectId, lease: l.id }), undefined, { timeoutMs: LEASE_CALL_TIMEOUT_MS });
  }
}
