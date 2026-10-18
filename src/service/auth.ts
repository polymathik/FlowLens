/**
 * Request authentication shared by the Express app and the RPC fast path:
 * loopback Host header (DNS-rebinding guard) + constant-time bearer check.
 * The token may come from `Authorization: Bearer` or `?access_token=`
 * (for browser EventSource, RFC 6750 §2.3).
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

function bearer(headers: IncomingHttpHeaders, url: string): string | undefined {
  const h = headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  const q = url.indexOf('?');
  return q < 0 ? undefined : new URLSearchParams(url.slice(q + 1)).get('access_token') ?? undefined;
}

/** DNS-rebinding guard: the Host header must name a loopback address. */
export function isLoopbackHost(headers: IncomingHttpHeaders): boolean {
  return LOOPBACK_HOSTS.has((headers.host ?? '').replace(/:\d+$/, ''));
}

/** Null when the request is allowed, else the error to send. */
export function authenticate(token: string, headers: IncomingHttpHeaders, url: string): ServiceError | null {
  if (!isLoopbackHost(headers)) return new ServiceError('forbidden_host', `Host "${headers.host}" not allowed`);
  if (!tokenMatches(token, bearer(headers, url))) return new ServiceError('unauthorized', 'Missing or invalid bearer token');
  return null;
}
