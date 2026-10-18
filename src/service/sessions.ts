/**
 * Browser sessions for the explorer.
 *
 * The bearer token never reaches the browser. The CLI (which can read
 * its daemon info file) mints a single-use code that lives 15 s (longer for
 * `--no-open`); `GET /auth?t=<code>`
 * consumes it and sets an HttpOnly, SameSite=Strict cookie holding a random
 * session id. Codes and sessions are kept only in memory, as SHA-256
 * digests, so a daemon restart signs every browser out.
 */
import { createHash, randomBytes } from 'node:crypto';
import { AUTH_CODE_TTL_MS, SESSION_COOKIE_PREFIX, SESSION_TTL_MS } from '../contracts/canvas/explorer.js';

const MAX_CODES = 32;
const MAX_SESSIONS = 64;

interface CodeEntry {
  expiresAt: number;
  redirect: string;
}

const digest = (s: string) => createHash('sha256').update(s).digest('hex');

/** Only `#/…` hash routes with URL-safe characters may be redirected to (no open redirect). */
export function safeRedirect(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('#/') || raw.length > 2048) return '#/home';
  return /^#\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/?]*$/.test(raw) ? raw : '#/home';
}

export class SessionStore {
  private codes = new Map<string, CodeEntry>();
  private sessions = new Map<string, number>();

  constructor(
    private readonly codeTtlMs = AUTH_CODE_TTL_MS,
    private readonly sessionTtlMs = SESSION_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Cookie name for a daemon on `port` (cookies are shared across ports of one host). */
  static cookieName(port: number): string {
    return `${SESSION_COOKIE_PREFIX}${port}`;
  }

  /** `ttlMs` overrides the store default (callers clamp it). */
  mintCode(redirect?: unknown, ttlMs = this.codeTtlMs): string {
    this.prune();
    if (this.codes.size >= MAX_CODES) this.codes.delete(this.codes.keys().next().value as string);
    const code = randomBytes(32).toString('base64url');
    this.codes.set(digest(code), { expiresAt: this.now() + ttlMs, redirect: safeRedirect(redirect) });
    return code;
  }

  get defaultCodeTtlMs(): number {
    return this.codeTtlMs;
  }

  /** Single use: returns a new session id + redirect, or null for an unknown/expired code. */
  exchange(code: unknown): { sessionId: string; redirect: string } | null {
    if (typeof code !== 'string' || code.length < 16 || code.length > 128) return null;
    const key = digest(code);
    const entry = this.codes.get(key);
    this.codes.delete(key);
    if (!entry || entry.expiresAt <= this.now()) return null;
    this.prune();
    if (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value as string);
    const sessionId = randomBytes(32).toString('base64url');
    this.sessions.set(digest(sessionId), this.now() + this.sessionTtlMs);
    return { sessionId, redirect: entry.redirect };
  }

  /** Valid sessions slide their expiry forward. */
  validate(sessionId: string | undefined): boolean {
    if (!sessionId) return false;
    const key = digest(sessionId);
    const exp = this.sessions.get(key);
    if (exp === undefined) return false;
    if (exp <= this.now()) {
      this.sessions.delete(key);
      return false;
    }
    this.sessions.set(key, this.now() + this.sessionTtlMs);
    return true;
  }

  get maxAgeSeconds(): number {
    return Math.floor(this.sessionTtlMs / 1000);
  }

  private prune(): void {
    const t = this.now();
    for (const [k, v] of this.codes) if (v.expiresAt <= t) this.codes.delete(k);
    for (const [k, v] of this.sessions) if (v <= t) this.sessions.delete(k);
  }
}

/** Read one cookie value from a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}
