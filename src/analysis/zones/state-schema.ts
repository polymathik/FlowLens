/** zod validation of `ZoneState` (Node and API side). */
import { z } from 'zod';
import { EMPTY_ZONE_STATE, ZONE_STATE_MAX_FILES, type ZoneOverridesIssue, type ZoneState } from '../../contracts/zones.js';

const KEY = z.string().min(1).max(1_000);
const stateSchema = z.object({ version: z.literal(1), assignment: z.record(KEY, KEY).default({}) });

export type ParsedState = { ok: true; value: ZoneState } | { ok: false; issues: ZoneOverridesIssue[] };

/** Validate untrusted input. Unknown fields are dropped; keys come back sorted; `__proto__` keys are refused. */
export function parseZoneState(raw: unknown): ParsedState {
  const rec = raw && typeof raw === 'object' ? (raw as { assignment?: unknown }).assignment : undefined;
  if (rec && typeof rec === 'object' && Object.hasOwn(rec, '__proto__')) {
    return { ok: false, issues: [{ path: 'assignment', message: '"__proto__" is not a valid key' }] };
  }
  const parsed = stateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.') || '(body)', message: i.message })) };
  }
  const entries = Object.entries(parsed.data.assignment);
  if (entries.length > ZONE_STATE_MAX_FILES) return { ok: false, issues: [{ path: 'assignment', message: `at most ${ZONE_STATE_MAX_FILES} files` }] };
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { ok: true, value: { version: 1, assignment: Object.fromEntries(entries) } };
}

export const emptyZoneState = (): ZoneState => structuredClone(EMPTY_ZONE_STATE);
