/** zod validation of `ZoneOverrides` (Node and API side; the pure `computeZones` does not need it). */
import { z } from 'zod';
import {
  EMPTY_ZONE_OVERRIDES, ZONE_COLOR_SLOTS, type ZoneOverrides, type ZoneOverridesIssue,
} from '../../contracts/zones.js';

const MAX_ENTRIES = 5_000;
const MAX_PINS = 20_000;
const KEY = z.string().min(1).max(1_000);

const zoneOverride = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  color: z.number().int().min(0).max(ZONE_COLOR_SLOTS - 1).optional(),
  collapsed: z.boolean().optional(),
  mergeInto: KEY.optional(),
});

const overridesSchema = z.object({
  version: z.literal(1),
  zones: z.record(KEY, zoneOverride).default({}),
  pins: z.record(KEY, KEY).default({}),
});

export type ParsedOverrides = { ok: true; value: ZoneOverrides } | { ok: false; issues: ZoneOverridesIssue[] };

const dotted = (path: ReadonlyArray<PropertyKey>): string => path.map(String).join('.') || '(body)';

/** Own keys named `__proto__` survive JSON.parse; refuse them so no consumer can be tricked by them. */
function hasProtoKey(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as { zones?: unknown; pins?: unknown };
  return [o.zones, o.pins].some((rec) => !!rec && typeof rec === 'object' && Object.hasOwn(rec, '__proto__'));
}

/** Validate untrusted input (a parsed JSON value). Unknown fields are dropped; keys come back sorted. */
export function parseZoneOverrides(raw: unknown): ParsedOverrides {
  if (hasProtoKey(raw)) return { ok: false, issues: [{ path: '(body)', message: '"__proto__" is not a valid key' }] };
  const parsed = overridesSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: dotted(i.path), message: i.message })) };
  }
  const { zones, pins, version } = parsed.data;
  if (Object.keys(zones).length > MAX_ENTRIES) return { ok: false, issues: [{ path: 'zones', message: `at most ${MAX_ENTRIES} zone entries` }] };
  if (Object.keys(pins).length > MAX_PINS) return { ok: false, issues: [{ path: 'pins', message: `at most ${MAX_PINS} pins` }] };
  const sorted = <T>(rec: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(rec).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const clean: ZoneOverrides = { version, zones: sorted(zones), pins: sorted(pins) };
  return { ok: true, value: clean };
}

export const emptyZoneOverrides = (): ZoneOverrides => structuredClone(EMPTY_ZONE_OVERRIDES);
