/**
 * `.flowlens/zones.json` store (Node side): zod-validated, atomic writes
 * (temp file + fsync + rename, via `projects/atomic.ts`), tolerant reads.
 *
 * A missing file is "no overrides". An unreadable, invalid or newer-version
 * file never throws: it is moved to `zones.json.corrupt` (so the user can
 * recover it) and the read returns empty overrides.
 */
import { mkdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomicAsync } from '../../projects/atomic.js';
import { ZONES_FILE, type ZoneOverrides, type ZoneOverridesStore } from '../../contracts/zones.js';
import { emptyZoneOverrides, parseZoneOverrides } from './overrides-schema.js';

export const zonesFilePath = (flowlensDir: string): string => join(flowlensDir, ZONES_FILE);

/** Thrown by `write` for a body that fails validation (never by `read`). */
export class InvalidZoneOverridesError extends Error {
  constructor(readonly issues: Array<{ path: string; message: string }>) {
    super(`Invalid zone overrides: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    this.name = 'InvalidZoneOverridesError';
  }
}

export function createZoneOverridesStore(): ZoneOverridesStore {
  // Writes to one file are applied in call order even when requests overlap.
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T>(path: string, task: () => Promise<T>): Promise<T> => {
    const next = (queues.get(path) ?? Promise.resolve()).then(task, task);
    queues.set(path, next.catch(() => undefined));
    return next;
  };

  return {
    async read(flowlensDir) {
      const path = zonesFilePath(flowlensDir);
      let text: string;
      try {
        text = await readFile(path, 'utf-8');
      } catch {
        return emptyZoneOverrides(); // missing, or unreadable (permissions, a directory…): leave it alone
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        raw = undefined;
      }
      const parsed = parseZoneOverrides(raw);
      if (parsed.ok) return parsed.value;
      await rename(path, `${path}.corrupt`).catch(() => undefined);
      return emptyZoneOverrides();
    },

    async write(flowlensDir, overrides) {
      const parsed = parseZoneOverrides(overrides);
      if (!parsed.ok) throw new InvalidZoneOverridesError(parsed.issues);
      const path = zonesFilePath(flowlensDir);
      await serial(path, async () => {
        await mkdir(flowlensDir, { recursive: true });
        await writeFileAtomicAsync(path, `${JSON.stringify(parsed.value, null, 2)}\n`);
      });
    },
  };
}
