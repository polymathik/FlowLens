/**
 * Pure helpers for editing an architecture rules draft in the canvas.
 * Types come from `src/contracts/architecture.ts` (never redeclared).
 *
 * Rule semantics (see analysis/architecture-validator.ts):
 * - `may_only_access` undefined → unrestricted; an array (even empty) → only those layers
 * - `must_not_access` → forbidden layers (undefined when empty)
 */
import type { ArchitectureConfig, ArchitectureLayer } from '../../contracts/architecture.js';

export type AccessRule = 'may_only_access' | 'must_not_access';

/** Fill required config fields for whatever the server returned (may be `{ layers: [] }`). */
export function normalizeConfig(raw: Partial<ArchitectureConfig> | null | undefined): ArchitectureConfig {
  return {
    version: 2,
    inferred_by: raw?.inferred_by ?? 'manual',
    inferred_at: raw?.inferred_at ?? new Date().toISOString(),
    layers: (raw?.layers ?? []).map((l) => ({
      ...l,
      include: { ...l.include, patterns: l.include?.patterns ?? [] },
    })),
  };
}

/** Config as saved by the editor: edits make it a manual config. */
export function toSavedConfig(draft: ArchitectureConfig, now = new Date()): ArchitectureConfig {
  return { ...draft, inferred_by: 'manual', inferred_at: now.toISOString() };
}

export function uniqueLayerName(layers: ArchitectureLayer[], base = 'new-layer'): string {
  const names = new Set(layers.map((l) => l.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function addLayer(config: ArchitectureConfig): ArchitectureConfig {
  return {
    ...config,
    layers: [...config.layers, { name: uniqueLayerName(config.layers), include: { patterns: [] } }],
  };
}

function mapRefs(list: string[] | undefined, fn: (n: string) => string | null): string[] | undefined {
  if (!list) return list;
  const out = list.map(fn).filter((n): n is string => n !== null);
  return out;
}

/** Remove a layer and every rule that references it. */
export function removeLayer(config: ArchitectureConfig, index: number): ArchitectureConfig {
  const name = config.layers[index]?.name;
  const layers = config.layers
    .filter((_, i) => i !== index)
    .map((l) => {
      const mustNot = mapRefs(l.must_not_access, (n) => (n === name ? null : n));
      return {
        ...l,
        may_only_access: mapRefs(l.may_only_access, (n) => (n === name ? null : n)),
        must_not_access: mustNot && mustNot.length > 0 ? mustNot : undefined,
      };
    });
  return { ...config, layers };
}

/** Rename a layer, keeping every rule that references it pointed at the new name. */
export function renameLayer(config: ArchitectureConfig, index: number, next: string): ArchitectureConfig {
  const prev = config.layers[index]?.name;
  const swap = (n: string) => (n === prev ? next : n);
  const layers = config.layers.map((l, i) => ({
    ...l,
    name: i === index ? next : l.name,
    may_only_access: mapRefs(l.may_only_access, swap),
    must_not_access: mapRefs(l.must_not_access, swap),
  }));
  return { ...config, layers };
}

export function updateLayer(
  config: ArchitectureConfig,
  index: number,
  patch: Partial<ArchitectureLayer>,
): ArchitectureConfig {
  const layers = config.layers.map((l, i) => (i === index ? { ...l, ...patch } : l));
  return { ...config, layers };
}

/** Toggle `target` in one of a layer's access lists. */
export function toggleAccess(
  config: ArchitectureConfig,
  index: number,
  rule: AccessRule,
  target: string,
): ArchitectureConfig {
  const layer = config.layers[index];
  const current = layer[rule] ?? [];
  const next = current.includes(target) ? current.filter((n) => n !== target) : [...current, target];
  const value = rule === 'must_not_access' && next.length === 0 ? undefined : next;
  return updateLayer(config, index, { [rule]: value });
}

/** Turn the "only these layers" restriction on ([]) or off (undefined). */
export function setRestricted(config: ArchitectureConfig, index: number, restricted: boolean): ArchitectureConfig {
  return updateLayer(config, index, { may_only_access: restricted ? [] : undefined });
}
