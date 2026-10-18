/**
 * Community state routes (Map v2 M3): `GET|PUT /api/projects/:id/canvas/zones/state`.
 *
 * Same trust model as the zones routes: bearer token or explorer session cookie (PUT with a same-origin
 * `Origin`, see `browser-auth.ts`); the body is validated (zod), capped at 2 MB by a JSON parser mounted
 * in `app.ts` before the daemon-wide one, and written atomically to `.flowlens/zone-state.json`.
 */
import express, { type Express, type RequestHandler } from 'express';
import {
  ZONE_STATE_MAX_BYTES, ZONE_STATE_ROUTE, type ZoneOverridesError, type ZoneState, type ZoneStateStore,
} from '../contracts/zones.js';
import type { ServiceDeps } from '../contracts/service-deps.js';
import { parseZoneState } from '../analysis/zones/state-schema.js';
import { createZoneStateStore } from '../analysis/zones/state-store.js';
import { projectFlowlensDir } from '../projects/paths.js';
import { projectParam, route } from './routes-projects.js';

export const zoneStateBodyParser = (): RequestHandler => express.json({ limit: ZONE_STATE_MAX_BYTES });

export function mountZoneStateRoutes(app: Express, deps: ServiceDeps, store: ZoneStateStore = createZoneStateStore()): void {
  app.get(ZONE_STATE_ROUTE, route(async (req, res) => {
    const p = await projectParam(deps, req, true);
    res.json((await store.read(projectFlowlensDir(p.root))) satisfies ZoneState);
  }));

  app.put(ZONE_STATE_ROUTE, route(async (req, res) => {
    const p = await projectParam(deps, req, true);
    const parsed = parseZoneState(req.body);
    if (!parsed.ok) {
      const body: ZoneOverridesError = {
        ok: false,
        error: { code: 'bad_request', message: `Invalid zone state: ${parsed.issues[0]?.path} ${parsed.issues[0]?.message}` },
        issues: parsed.issues,
      };
      res.status(400).json(body);
      return;
    }
    const dir = projectFlowlensDir(p.root);
    await store.write(dir, parsed.value);
    res.json(await store.read(dir));
  }));
}
