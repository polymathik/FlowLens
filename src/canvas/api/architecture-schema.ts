/**
 * Zod validation for architecture configs POSTed by the canvas rule editor.
 * The parsed output satisfies `ArchitectureConfig` from
 * `src/contracts/architecture.ts`; missing metadata (version, inferred_by,
 * inferred_at) is filled in so older or hand-written files still load.
 */
import { z } from 'zod';
import type { ArchitectureConfig } from '../../contracts/architecture.js';
import type { ConfigIssue } from '../../contracts/canvas/index.js';

const nonEmpty = z.string().trim().min(1, 'must not be empty');

const layerSchema = z.object({
  name: nonEmpty,
  include: z
    .object({
      patterns: z.array(nonEmpty).optional(),
      files: z.array(nonEmpty).optional(),
      entities: z.array(nonEmpty).optional(),
    })
    .default({ patterns: [] }),
  may_only_access: z.array(nonEmpty).optional(),
  must_not_access: z.array(nonEmpty).optional(),
});

const configSchema = z
  .object({
    version: z.literal(2).default(2),
    inferred_by: z.enum(['heuristic', 'ai:anthropic', 'ai:ollama', 'manual']).default('manual'),
    inferred_at: z.string().default(() => new Date().toISOString()),
    layers: z.array(layerSchema),
  })
  .superRefine((cfg, ctx) => {
    const names = new Set<string>();
    cfg.layers.forEach((layer, i) => {
      if (names.has(layer.name)) {
        ctx.addIssue({ code: 'custom', path: ['layers', i, 'name'], message: `duplicate layer name "${layer.name}"` });
      }
      names.add(layer.name);
    });
    cfg.layers.forEach((layer, i) => {
      for (const rule of ['may_only_access', 'must_not_access'] as const) {
        (layer[rule] ?? []).forEach((ref, j) => {
          if (!names.has(ref)) {
            ctx.addIssue({ code: 'custom', path: ['layers', i, rule, j], message: `unknown layer "${ref}"` });
          } else if (ref === layer.name) {
            ctx.addIssue({ code: 'custom', path: ['layers', i, rule, j], message: 'a layer cannot reference itself' });
          }
        });
      }
    });
  });

export type ParseResult =
  | { ok: true; config: ArchitectureConfig }
  | { ok: false; issues: ConfigIssue[] };

export function parseArchitectureConfig(input: unknown): ParseResult {
  const result = configSchema.safeParse(input);
  if (result.success) return { ok: true, config: result.data satisfies ArchitectureConfig };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  };
}
