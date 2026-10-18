/**
 * What the daemon's route modules receive (Phase 12 review L6: moved out of
 * service/app.ts so route modules depend on a contract, not on the app
 * module that mounts them — this removed the type-only import loop
 * service/app.ts <-> service/routes-*.ts). The members are the daemon's
 * own building blocks, referenced type-only.
 */
import type { Express } from 'express';
import type { ServiceOptions } from './service.js';
import type { FileProjectRegistry } from '../projects/registry.js';
import type { EventHub } from '../service/events.js';
import type { GraphPool } from '../service/graph-pool.js';
import type { ProjectCache } from '../service/project-cache.js';
import type { SessionStore } from '../service/sessions.js';
import type { Logger, WatcherManager } from '../service/watchers.js';

export interface ServiceDeps {
  token: string;
  registry: FileProjectRegistry;
  /** Cached registry lookups for hot routes. */
  projects: ProjectCache;
  pool: GraphPool;
  watchers: WatcherManager;
  hub: EventHub;
  options: ServiceOptions;
  version: string;
  startedAt: number;
  /** Called by POST /api/shutdown after the response is sent. */
  onShutdown: () => void;
  log: Logger;
  /** Bound port, filled in once listening. */
  port?: number;
  /** Called on every authenticated request (daemon idle-exit bookkeeping). */
  onActivity?: () => void;
  /** Explorer browser sessions (cookie auth); absent = bearer only. */
  sessions?: SessionStore;
}

/** Extra routes (e.g. the explorer UI, wave 2), mounted before the 404/error handlers. */
export type MountRoutes = (app: Express, deps: ServiceDeps) => void;
