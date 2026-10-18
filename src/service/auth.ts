/**
 * Request authentication shared by the Express app and the RPC fast path:
 * loopback Host header (DNS-rebinding guard) + constant-time bearer check.
 * The token comes from `Authorization: Bearer`; only the SSE route
 * (`GET /api/projects/:id/events`) also accepts `?access_token=`, because
 * browsers' EventSource cannot set headers (RFC 6750 §2.3 — a query token
 * leaks into logs/history, so it is not accepted anywhere else).
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { ServiceError } from './errors.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function tokenMatches(expected: string, given: string | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The only route where a query-string token is accepted (SERVICE_ROUTES.events). */
const SSE_PATH = /^\/api\/projects\/[^/?]+\/events$/;

function bearer(headers: IncomingHttpHeaders, url: string, method?: string): string | undefined {
  const h = headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  const q = url.indexOf('?');
  if (q < 0 || (method !== undefined && method !== 'GET') || !SSE_PATH.test(url.slice(0, q))) return undefined;
  return new URLSearchParams(url.slice(q + 1)).get('access_token') ?? undefined;
}

/** DNS-rebinding guard: the Host header must name a loopback address. */
export function isLoopbackHost(headers: IncomingHttpHeaders): boolean {
  return LOOPBACK_HOSTS.has((headers.host ?? '').replace(/:\d+$/, ''));
}

/** Null when the request is allowed, else the error to send. */
export function authenticate(token: string, headers: IncomingHttpHeaders, url: string, method?: string): ServiceError | null {
  if (!isLoopbackHost(headers)) return new ServiceError('forbidden_host', `Host "${headers.host}" not allowed`);
  if (!tokenMatches(token, bearer(headers, url, method))) return new ServiceError('unauthorized', 'Missing or invalid bearer token');
  return null;
}
