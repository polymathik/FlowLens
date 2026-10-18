/**
 * DaemonClient — low-overhead HTTP/1.1 client for the graph service.
 * Uses one keep-alive `http.Agent` (no per-call TCP handshake), sends the
 * bearer token on every request, and parses JSON from the raw buffers.
 */
import http from 'node:http';
import { DAEMON_HOST, type DaemonInfo, type PingResponse, type ServiceEvent, type ServiceErrorBody } from '../contracts/service.js';
import { RemoteServiceError } from './errors.js';

export interface RequestOptions {
  timeoutMs?: number;
}

/** Errors that mean "the daemon went away" (reconnect + retry is safe). */
export function isConnectionError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE'
    || code === 'ENOTFOUND' || (err as Error).message === 'socket hang up';
}

export interface Subscription {
  close(): void;
}

export class DaemonClient {
  private readonly agent = new http.Agent({ keepAlive: true, maxSockets: 32 });

  constructor(public readonly info: DaemonInfo) {}

  request<T>(method: string, path: string, body?: unknown, o: RequestOptions = {}): Promise<T> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return new Promise<T>((resolve, reject) => {
      const req = http.request({
        host: DAEMON_HOST,
        port: this.info.port,
        method,
        path,
        agent: this.agent,
        headers: {
          Authorization: `Bearer ${this.info.token}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown;
          try {
            parsed = text === '' ? null : JSON.parse(text);
          } catch {
            reject(new Error(`Graph service returned invalid JSON (HTTP ${res.statusCode})`));
            return;
          }
          const status = res.statusCode ?? 0;
          if (status >= 400) {
            const e = (parsed as ServiceErrorBody | null)?.error;
            reject(new RemoteServiceError(e?.code ?? 'internal', e?.message ?? `HTTP ${status}`, status));
            return;
          }
          resolve(parsed as T);
        });
      });
      req.on('error', reject);
      if (o.timeoutMs) {
        req.setTimeout(o.timeoutMs, () => req.destroy(Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' })));
      }
      if (payload) req.end(payload);
      else req.end();
    });
  }

  /** Ping with a short timeout; null when unreachable or unauthorized. */
  async ping(timeoutMs = 1000): Promise<PingResponse | null> {
    try {
      return await this.request<PingResponse>('GET', '/api/ping', undefined, { timeoutMs });
    } catch {
      return null;
    }
  }

  /** Subscribe to a project's SSE channel; reconnects until closed. */
  subscribe(projectId: string, onEvent: (e: ServiceEvent) => void): Subscription {
    let closed = false;
    let current: http.ClientRequest | null = null;
    const connect = () => {
      if (closed) return;
      let buf = '';
      current = http.get({
        host: DAEMON_HOST,
        port: this.info.port,
        path: `/api/projects/${encodeURIComponent(projectId)}/events`,
        headers: { Authorization: `Bearer ${this.info.token}`, Accept: 'text/event-stream' },
      }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buf += chunk;
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const data = frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
            if (data) {
              try { onEvent(JSON.parse(data) as ServiceEvent); } catch { /* ignore malformed frame */ }
            }
          }
        });
        res.on('end', () => retry());
      });
      current.on('error', () => retry());
    };
    const retry = () => {
      if (!closed) setTimeout(connect, 1000).unref();
    };
    connect();
    return {
      close: () => {
        closed = true;
        current?.destroy();
      },
    };
  }

  destroy(): void {
    this.agent.destroy();
  }
}
