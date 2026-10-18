/**
 * Zone overrides routes (Map v2, M2): `GET|PUT /api/projects/:id/canvas/zones`.
 *
 * Same trust model as the other canvas routes: everything under `/api`
 * requires the bearer token or an explorer session cookie (PUT with a
 * same-origin `Origin`, see `browser-auth.ts`). The body is validated
 * (zod), capped at 256 KB (the JSON parser for this one path is mounted in
 * `app.ts` before the daemon-wide 512 MB parser, so an oversized body is
 * refused with 413 while it streams in), and written atomically to the
 * project's `.flowlens/zones.json`. Mounted before the generic canvas
 * router, which would otherwise answer 404.
 */
import express, { type Express, type RequestHandler } from 'express';
import {
  ZONE_OVERRIDES_MAX_BYTES, ZONES_ROUTE, type ZoneOverrides, type ZoneOverridesError, type ZoneOverridesStore,
} from '../contracts/zones.js';
import type { ServiceDeps } from '../contracts/service-deps.js';
import { parseZoneOverrides } from '../analysis/zones/overrides-schema.js';
import { createZoneOverridesStore } from '../analysis/zones/overrides-store.js';
import { projectFlowlensDir } from '../projects/paths.js';
import { projectParam, route } from './routes-projects.js';
import { mountZoneStateRoutes } from './routes-zone-state.js';

/** JSON parser limited to the zones body cap (mount before any larger parser). */
export const zonesBodyParser = (): RequestHandler => express.json({ limit: ZONE_OVERRIDES_MAX_BYTES });

export function mountZonesRoutes(app: Express, deps: ServiceDeps, store: ZoneOverridesStore = createZoneOverridesStore()): void {
  app.get(ZONES_ROUTE, route(async (req, res) => {
    const p = await projectParam(deps, req, true);
    res.json((await store.read(projectFlowlensDir(p.root))) satisfies ZoneOverrides);
  }));

  app.put(ZONES_ROUTE, route(async (req, res) => {
    const p = await projectParam(deps, req, true);
    const parsed = parseZoneOverrides(req.body);
    if (!parsed.ok) {
      const body: ZoneOverridesError = {
        ok: false,
        error: { code: 'bad_request', message: `Invalid zone overrides: ${parsed.issues[0]?.path} ${parsed.issues[0]?.message}` },
        issues: parsed.issues,
      };
      res.status(400).json(body);
      return;
    }
    const dir = projectFlowlensDir(p.root);
    await store.write(dir, parsed.value);
    res.json(await store.read(dir));
  }));

  mountZoneStateRoutes(app, deps); // `.../zones/state` (community assignment), next to the overrides
}
