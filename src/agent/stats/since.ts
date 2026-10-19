import { AgentUsageError } from '../options.js';

const UNIT_MS: Record<string, number> = { h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };

/** `--since` value (`12h`, `7d`, `2w`, or an ISO date/time) to epoch milliseconds. */
export function parseSince(value: string, now = Date.now()): number {
  const text = value.trim();
  const rel = /^(\d{1,4})([hdw])$/i.exec(text);
  if (rel) return now - Number(rel[1]) * UNIT_MS[rel[2]!.toLowerCase()]!;
  const iso = /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(text) ? Date.parse(text) : NaN;
  if (Number.isFinite(iso)) return iso;
  throw new AgentUsageError(`Invalid --since "${value}". Use a length of time like 7d, 12h or 2w, or a date like 2026-10-01.`);
}

/** `--limit` value: a whole number from 1 to 1000. */
export function parseLimit(value: unknown): number {
  const text = String(value).trim();
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    throw new AgentUsageError(`Invalid --limit "${String(value)}". Expected a whole number from 1 to 1000.`);
  }
  return n;
}
