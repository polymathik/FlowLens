/**
 * The canvas' one HTTP helper. Same-origin requests carry the explorer
 * session cookie automatically; a 401 means the browser session is gone
 * (daemon restarted or expired) and is reported to `onSignedOut`
 * listeners so the shell can explain how to sign in again.
 */
import type { ConfigIssue } from '../../contracts/canvas/index.js';

/** HTTP error carrying the status and any validation issues from the server. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: ConfigIssue[] = [],
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const signedOutListeners = new Set<() => void>();

export function onSignedOut(fn: () => void): () => void {
  signedOutListeners.add(fn);
  return () => signedOutListeners.delete(fn);
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    let issues: ConfigIssue[] = [];
    let message = `${url} returned ${res.status}: ${res.statusText}`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: string | { code?: string; message?: string }; issues?: ConfigIssue[] };
      if (Array.isArray(body.issues)) issues = body.issues;
      if (typeof body.error === 'string') message = body.error;
      else if (body.error) {
        message = body.error.message ?? message;
        code = body.error.code;
      }
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) for (const fn of signedOutListeners) fn();
    throw new ApiError(message, res.status, issues, code);
  }
  return res.json() as Promise<T>;
}

export function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export function putJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}
