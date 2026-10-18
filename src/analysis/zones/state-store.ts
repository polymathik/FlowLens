/**
 * `.flowlens/zone-state.json` store (Node side): the last community assignment, so communities keep their
 * keys across re-indexes and reloads. Same guarantees as `overrides-store.ts`: zod-validated, atomic
 * writes (temp file + fsync + rename), tolerant reads. It is derived data: a missing, unreadable or
 * invalid file reads as an empty state (an invalid one is moved to `zone-state.json.corrupt`).
 */
import { mkdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomicAsync } from '../../projects/atomic.js';
import { ZONE_STATE_FILE, type ZoneStateStore } from '../../contracts/zones.js';
import { emptyZoneState, parseZoneState } from './state-schema.js';

export const zoneStatePath = (flowlensDir: string): string => join(flowlensDir, ZONE_STATE_FILE);

export class InvalidZoneStateError extends Error {
  constructor(readonly issues: Array<{ path: string; message: string }>) {
    super(`Invalid zone state: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    this.name = 'InvalidZoneStateError';
  }
}

export function createZoneStateStore(): ZoneStateStore {
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T>(path: string, task: () => Promise<T>): Promise<T> => {
    const next = (queues.get(path) ?? Promise.resolve()).then(task, task);
    queues.set(path, next.catch(() => undefined));
    return next;
  };
  return {
    async read(flowlensDir) {
      const path = zoneStatePath(flowlensDir);
      let text: string;
      try {
        text = await readFile(path, 'utf-8');
      } catch {
        return emptyZoneState();
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        raw = undefined;
      }
      const parsed = parseZoneState(raw);
      if (parsed.ok) return parsed.value;
      await rename(path, `${path}.corrupt`).catch(() => undefined);
      return emptyZoneState();
    },
    async write(flowlensDir, state) {
      const parsed = parseZoneState(state);
      if (!parsed.ok) throw new InvalidZoneStateError(parsed.issues);
      const path = zoneStatePath(flowlensDir);
      await serial(path, async () => {
        await mkdir(flowlensDir, { recursive: true });
        await writeFileAtomicAsync(path, `${JSON.stringify(parsed.value)}\n`);
      });
    },
  };
}
