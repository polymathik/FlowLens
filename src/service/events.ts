/**
 * Server-Sent Events hub: one channel per project. Clients subscribe with
 * `GET /api/projects/:id/events`; the daemon broadcasts `graph-changed`
 * after watcher updates and (debounced) after RPC writes.
 */
import type { Response } from 'express';
import type { ServiceEvent } from '../contracts/service.js';

const HEARTBEAT_MS = 25_000;

export class EventHub {
  private channels = new Map<string, Set<Response>>();
  private debounce = new Map<string, NodeJS.Timeout>();
  private heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => this.ping(), HEARTBEAT_MS).unref();
  }

  subscribe(projectId: string, res: Response): void {
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    let set = this.channels.get(projectId);
    if (!set) this.channels.set(projectId, (set = new Set()));
    set.add(res);
    this.write(res, { type: 'hello', project_id: projectId, at: new Date().toISOString() });
    res.on('close', () => {
      set?.delete(res);
      if (set?.size === 0) this.channels.delete(projectId);
    });
  }

  broadcast(projectId: string, event: ServiceEvent): void {
    for (const res of this.channels.get(projectId) ?? []) this.write(res, event);
  }

  /** Coalesce bursts of RPC writes into one event `delayMs` after the last. */
  broadcastDebounced(projectId: string, delayMs: number, make: () => ServiceEvent): void {
    if (!this.channels.has(projectId)) return;
    const prev = this.debounce.get(projectId);
    if (prev) clearTimeout(prev);
    this.debounce.set(projectId, setTimeout(() => {
      this.debounce.delete(projectId);
      this.broadcast(projectId, make());
    }, delayMs).unref());
  }

  subscriberCount(projectId?: string): number {
    if (projectId) return this.channels.get(projectId)?.size ?? 0;
    let n = 0;
    for (const s of this.channels.values()) n += s.size;
    return n;
  }

  closeAll(): void {
    clearInterval(this.heartbeat);
    for (const t of this.debounce.values()) clearTimeout(t);
    for (const set of this.channels.values()) for (const res of set) res.end();
    this.channels.clear();
  }

  private write(res: Response, event: ServiceEvent): void {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  private ping(): void {
    for (const set of this.channels.values()) for (const res of set) res.write(': ping\n\n');
  }
}
