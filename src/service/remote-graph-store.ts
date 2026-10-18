/**
 * RemoteGraphStore — the `GraphStore` contract over the daemon's RPC.
 *
 * `open(<root>/.flowlens/graph)` resolves (and registers) the project and
 * takes a lease that is renewed in the background; `close()` releases it.
 * If the daemon disappears mid-session (crash, `daemon stop`, upgrade) or
 * the project is removed from the registry (explorer "Remove from list"),
 * the next call recovers — reconnecting / re-registering, re-leasing — and
 * retries once (see remote-session.ts), so a long-lived `serve` survives.
 *
 * Every call has a timeout (`rpcTimeoutMs`, default 30 s, env
 * `FLOWLENS_RPC_TIMEOUT_MS`); `reindex` has its own, longer one because it
 * waits in the project's write queue and then runs the indexer.
 */
import { basename, dirname, resolve } from 'node:path';
import type { Entity, EntityKind } from '../contracts/entities.js';
import type { GraphStore } from '../contracts/graph.js';
import type { IndexResult } from '../contracts/indexer.js';
import type { Relation, RelationType } from '../contracts/relations.js';
import {
  routePath, SERVICE_ROUTES, type GraphChangedEvent, type GraphRpcMethod,
  type GraphRpcSuccess, type ReindexRequest, type ReindexResponse, type ServiceEvent,
} from '../contracts/service.js';
import type { RemoteStoreOptions } from '../contracts/open-graph.js';
import { connectDaemon } from './autostart.js';
import type { Subscription } from './client.js';
import { RemoteSession, type Connect } from './remote-session.js';

export type { Connect } from './remote-session.js';

/** Override the default per-call RPC timeout (ms). */
export const RPC_TIMEOUT_ENV = 'FLOWLENS_RPC_TIMEOUT_MS';
export const DEFAULT_RPC_TIMEOUT_MS = 30_000;
export const DEFAULT_REINDEX_TIMEOUT_MS = 10 * 60_000;

function envTimeout(): number | undefined {
  const v = Number(process.env[RPC_TIMEOUT_ENV]);
  return process.env[RPC_TIMEOUT_ENV] !== undefined && Number.isFinite(v) && v > 0 ? v : undefined;
}

export class RemoteGraphStore implements GraphStore {
  private session: RemoteSession | null = null;
  private readonly rpcTimeoutMs: number;
  private readonly reindexTimeoutMs: number;

  constructor(
    private readonly connect: Connect = () => connectDaemon(),
    private readonly clientLabel = 'cli',
    o: RemoteStoreOptions = {},
  ) {
    this.rpcTimeoutMs = o.rpcTimeoutMs ?? envTimeout() ?? DEFAULT_RPC_TIMEOUT_MS;
    this.reindexTimeoutMs = o.reindexTimeoutMs ?? DEFAULT_REINDEX_TIMEOUT_MS;
  }

  get projectId(): string | null {
    return this.session?.project?.id ?? null;
  }

  /* ---------------- lifecycle ---------------- */

  async open(dbPath: string): Promise<void> {
    const abs = resolve(dbPath);
    if (basename(abs) !== 'graph' || basename(dirname(abs)) !== '.flowlens') {
      throw new Error(`RemoteGraphStore expects <root>/.flowlens/graph, got ${dbPath}`);
    }
    this.session = new RemoteSession(this.connect, dirname(dirname(abs)));
    await this.session.attach();
    await this.session.addLease({ client: this.clientLabel });
  }

  async close(): Promise<void> {
    await this.session?.close();
  }

  /**
   * Ask the daemon to watch this project's files (joining an existing
   * watcher) and deliver `graph-changed` events from the watcher.
   */
  async watch(debounceMs: number, onChange: (e: GraphChangedEvent) => void): Promise<void> {
    await this.requireSession().addLease({ client: `${this.clientLabel}:watch`, watch: true, debounce_ms: debounceMs });
    this.subscribe((e) => { if (e.source === 'watch') onChange(e); });
  }

  /** All graph-changed events for this project (watch and RPC writes). */
  subscribe(onChange: (e: GraphChangedEvent) => void): Subscription {
    return this.requireSession().subscribe((e: ServiceEvent) => { if (e.type === 'graph-changed') onChange(e); });
  }

  /**
   * Run the incremental indexer in the daemon (in the project's write
   * queue, so concurrent runs never lose each other's edits).
   */
  reindex(req: ReindexRequest = {}): Promise<IndexResult> {
    return this.withRecovery(async () => {
      const { project } = this.requireSession().requireOpen();
      const res = await this.requireSession().request<ReindexResponse>(
        'POST', routePath(SERVICE_ROUTES.reindex, { id: project.id }), req, { timeoutMs: this.reindexTimeoutMs },
      );
      return res.result;
    });
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
  replaceFile(filePath: string, entities: Entity[], relations: Relation[]): Promise<void> {
    return this.call('replaceFile', [filePath, entities, relations]);
  }
  getUnresolvedRelations(): Promise<Relation[]> { return this.call('getUnresolvedRelations', []); }

  /* ---------------- internals ---------------- */

  private requireSession(): RemoteSession {
    if (!this.session) throw new Error('RemoteGraphStore is not open');
    return this.session;
  }

  private call<T>(method: GraphRpcMethod, args: unknown[]): Promise<T> {
    return this.withRecovery(async () => {
      const { project } = this.requireSession().requireOpen();
      const res = await this.requireSession().request<GraphRpcSuccess>(
        'POST', routePath(SERVICE_ROUTES.rpc, { id: project.id }), { method, args }, { timeoutMs: this.rpcTimeoutMs },
      );
      return (method.startsWith('get') ? res.result : undefined) as T;
    });
  }

  /** Run `send`; on a recoverable failure recover once and retry. */
  private async withRecovery<T>(send: () => Promise<T>): Promise<T> {
    try {
      return await send();
    } catch (err) {
      await this.requireSession().recover(err);
      return send();
    }
  }
}
