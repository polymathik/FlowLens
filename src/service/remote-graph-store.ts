/**
 * RemoteGraphStore — the `GraphStore` contract over the daemon's RPC.
 *
 * `open(<root>/.flowlens/graph)` resolves (and registers) the project and
 * takes a lease that is renewed in the background; `close()` releases it.
 * If the daemon disappears mid-session (crash, `daemon stop`, upgrade) the
 * next call reconnects — auto-starting a new daemon — re-leases and
 * retries once, so a long-lived `serve` survives daemon restarts.
 */
import { basename, dirname, resolve } from 'node:path';
import type { Entity, EntityKind } from '../contracts/entities.js';
import type { GraphStore } from '../contracts/graph.js';
import type { ProjectWithStatus } from '../contracts/projects.js';
import type { Relation, RelationType } from '../contracts/relations.js';
import {
  routePath, SERVICE_ROUTES, type GraphChangedEvent, type GraphRpcMethod,
  type GraphRpcSuccess, type LeaseRequest, type LeaseResponse, type ServiceEvent,
} from '../contracts/service.js';
import { connectDaemon } from './autostart.js';
import { isConnectionError, type DaemonClient, type Subscription } from './client.js';
import { RemoteServiceError } from './errors.js';

export type Connect = () => Promise<DaemonClient>;

interface LeaseState {
  id: string;
  req: LeaseRequest;
  timer: NodeJS.Timeout;
}

export class RemoteGraphStore implements GraphStore {
  private client: DaemonClient | null = null;
  private project: ProjectWithStatus | null = null;
  private root = '';
  private reconnecting: Promise<void> | null = null;
  private leases: LeaseState[] = [];
  private subs: Array<{ onEvent: (e: ServiceEvent) => void; sub: Subscription }> = [];

  constructor(
    private readonly connect: Connect = () => connectDaemon(),
    private readonly clientLabel = 'cli',
  ) {}

  get projectId(): string | null {
    return this.project?.id ?? null;
  }

  /* ---------------- lifecycle ---------------- */

  async open(dbPath: string): Promise<void> {
    const abs = resolve(dbPath);
    if (basename(abs) !== 'graph' || basename(dirname(abs)) !== '.flowlens') {
      throw new Error(`RemoteGraphStore expects <root>/.flowlens/graph, got ${dbPath}`);
    }
    this.root = dirname(dirname(abs));
    await this.attach();
    await this.addLease({ client: this.clientLabel });
  }

  async close(): Promise<void> {
    for (const s of this.subs) s.sub.close();
    this.subs = [];
    const leases = this.leases;
    this.leases = [];
    for (const l of leases) {
      clearInterval(l.timer);
      await this.leaseCall('DELETE', l.id).catch(() => undefined);
    }
    this.client?.destroy();
    this.client = null;
  }

  /**
   * Ask the daemon to watch this project's files (joining an existing
   * watcher) and deliver `graph-changed` events from the watcher.
   */
  async watch(debounceMs: number, onChange: (e: GraphChangedEvent) => void): Promise<void> {
    await this.addLease({ client: `${this.clientLabel}:watch`, watch: true, debounce_ms: debounceMs });
    this.subscribe((e) => { if (e.source === 'watch') onChange(e); });
  }

  /** All graph-changed events for this project (watch and RPC writes). */
  subscribe(onChange: (e: GraphChangedEvent) => void): Subscription {
    const { client, project } = this.requireOpen();
    const onEvent = (e: ServiceEvent) => { if (e.type === 'graph-changed') onChange(e); };
    const entry = { onEvent, sub: client.subscribe(project.id, onEvent) };
    this.subs.push(entry);
    return {
      close: () => {
        entry.sub.close();
        this.subs = this.subs.filter((x) => x !== entry);
      },
    };
  }

  /* ---------------- GraphStore ---------------- */

  putNode(entity: Entity): Promise<void> { return this.call('putNode', [entity]); }
  getNode(id: string): Promise<Entity | null> { return this.call('getNode', [id]); }
  getNodesByKind(kind: EntityKind): Promise<Entity[]> { return this.call('getNodesByKind', [kind]); }
  getNodesByFile(filePath: string): Promise<Entity[]> { return this.call('getNodesByFile', [filePath]); }
  deleteNode(id: string): Promise<void> { return this.call('deleteNode', [id]); }
  deleteNodesByFile(filePath: string): Promise<void> { return this.call('deleteNodesByFile', [filePath]); }
  putEdge(relation: Relation): Promise<void> { return this.call('putEdge', [relation]); }
  getEdgesFrom(entityId: string, type?: RelationType): Promise<Relation[]> {
    return this.call('getEdgesFrom', type === undefined ? [entityId] : [entityId, type]);
  }
  getEdgesTo(entityId: string, type?: RelationType): Promise<Relation[]> {
    return this.call('getEdgesTo', type === undefined ? [entityId] : [entityId, type]);
  }
  deleteEdge(id: string): Promise<void> { return this.call('deleteEdge', [id]); }
  deleteEdgesByFile(filePath: string): Promise<void> { return this.call('deleteEdgesByFile', [filePath]); }
  putNodes(entities: Entity[]): Promise<void> { return this.call('putNodes', [entities]); }
  putEdges(relations: Relation[]): Promise<void> { return this.call('putEdges', [relations]); }
  getAllNodes(): Promise<Entity[]> { return this.call('getAllNodes', []); }
  getAllEdges(): Promise<Relation[]> { return this.call('getAllEdges', []); }
  clear(): Promise<void> { return this.call('clear', []); }

  /* ---------------- internals ---------------- */

  private requireOpen(): { client: DaemonClient; project: ProjectWithStatus } {
    if (!this.client || !this.project) throw new Error('RemoteGraphStore is not open');
    return { client: this.client, project: this.project };
  }

  private async attach(): Promise<void> {
    this.client?.destroy();
    this.client = await this.connect();
    this.project = await this.client.request<ProjectWithStatus>(
      'POST', SERVICE_ROUTES.resolve, { root: this.root, register: true },
    );
  }

  private async call<T>(method: GraphRpcMethod, args: unknown[]): Promise<T> {
    const send = async () => {
      const { client, project } = this.requireOpen();
      const res = await client.request<GraphRpcSuccess>(
        'POST', routePath(SERVICE_ROUTES.rpc, { id: project.id }), { method, args },
      );
      return (method.startsWith('get') ? res.result : undefined) as T;
    };
    try {
      return await send();
    } catch (err) {
      if (!isConnectionError(err)) throw err;
      await this.reconnect();
      return send();
    }
  }

  /** Single-flight: concurrent failures share one reconnect. */
  private reconnect(): Promise<void> {
    this.reconnecting ??= this.doReconnect().finally(() => { this.reconnecting = null; });
    return this.reconnecting;
  }

  private async doReconnect(): Promise<void> {
    await this.attach();
    for (const l of this.leases) await this.reacquire(l);
    const { client, project } = this.requireOpen();
    for (const s of this.subs) {
      s.sub.close();
      s.sub = client.subscribe(project.id, s.onEvent);
    }
  }

  private async addLease(req: LeaseRequest): Promise<void> {
    const { client, project } = this.requireOpen();
    const res = await client.request<LeaseResponse>(
      'POST', routePath(SERVICE_ROUTES.leases, { id: project.id }), req,
    );
    const state = { id: res.lease_id, req } as LeaseState;
    state.timer = setInterval(() => void this.renew(state), Math.max(200, res.ttl_ms / 3));
    state.timer.unref();
    this.leases.push(state);
  }

  private async renew(l: LeaseState): Promise<void> {
    try {
      await this.leaseCall('PUT', l.id);
    } catch (err) {
      const lost = err instanceof RemoteServiceError && err.code === 'not_found';
      try {
        if (isConnectionError(err)) await this.reconnect();
        else if (lost) await this.reacquire(l);
      } catch { /* try again next tick */ }
    }
  }

  private async reacquire(l: LeaseState): Promise<void> {
    const { client, project } = this.requireOpen();
    const res = await client.request<LeaseResponse>(
      'POST', routePath(SERVICE_ROUTES.leases, { id: project.id }), l.req,
    );
    l.id = res.lease_id;
  }

  private leaseCall(method: 'PUT' | 'DELETE', leaseId: string): Promise<unknown> {
    const { client, project } = this.requireOpen();
    return client.request(method, routePath(SERVICE_ROUTES.lease, { id: project.id, lease: leaseId }), undefined, { timeoutMs: 5_000 });
  }
}
