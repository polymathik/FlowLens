/**
 * Typed service errors and their HTTP mapping (see contracts/service.ts).
 */
import {
  SERVICE_ERROR_STATUS, type ServiceErrorBody, type ServiceErrorCode,
} from '../contracts/service.js';

export class ServiceError extends Error {
  constructor(public readonly code: ServiceErrorCode, message: string) {
    super(message);
    this.name = 'ServiceError';
  }

  get status(): number {
    return SERVICE_ERROR_STATUS[this.code];
  }
}

export function errorBody(code: ServiceErrorCode, message: string): ServiceErrorBody {
  return { ok: false, error: { code, message } };
}

/** True when an error (or its cause chain) is LevelDB's "already locked". */
export function isLockError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    const x = e as { code?: string; message?: string; cause?: unknown };
    if (x.code === 'LEVEL_LOCKED' || /\bLOCK\b|lock hold|locked/i.test(x.message ?? '')) return true;
    e = x.cause;
  }
  return false;
}

export function toServiceError(err: unknown): ServiceError {
  if (err instanceof ServiceError) return err;
  if (isLockError(err)) {
    return new ServiceError(
      'graph_locked',
      'Another process holds this project\'s graph database lock (a FlowLens command run with --no-daemon or an older FlowLens).',
    );
  }
  return new ServiceError('internal', err instanceof Error ? err.message : String(err));
}

/** Rebuild an Error on the client side from a ServiceErrorBody. */
export class RemoteServiceError extends Error {
  constructor(public readonly code: ServiceErrorCode, message: string, public readonly status: number) {
    super(message);
    this.name = 'RemoteServiceError';
  }
}
