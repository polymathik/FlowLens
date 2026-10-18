/**
 * AI integration check — reads the `ai` block of `.flowlens/config.json`.
 * AI is optional: when it is off (or absent) the check reports `skipped`
 * ("disabled"), never a green "ok". When on, it validates the provider and
 * that the API-key env var is set. No live API call (local-first; would
 * need network + a key).
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAIProvider } from '../../ai/ai-integration.js';
import { DEFAULT_API_KEY_ENV, DEFAULT_MODELS } from '../../contracts/ai-integration.js';
import type { DiagnosticCheck, DiagnosticRunner } from '../../contracts/doctor.js';

const BASE = { name: 'ai-configured', title: 'AI integration' };

interface AIBlock {
  enabled?: boolean;
  provider?: unknown;
  model?: string;
  api_key_env?: string;
}

export const aiConfiguredCheck: DiagnosticRunner = async ({ flowlensDir }) => {
  const configPath = join(flowlensDir, 'config.json');
  if (!existsSync(configPath)) return disabled('not configured (optional)');
  let ai: AIBlock | undefined;
  try {
    ai = (JSON.parse(await readFile(configPath, 'utf-8')) as { ai?: AIBlock }).ai;
  } catch {
    return { ...BASE, status: 'warning', message: 'could not parse config.json for AI block' };
  }
  return evaluateAIBlock(ai, process.env);
};

/** Pure evaluation, exported for tests. */
export function evaluateAIBlock(
  ai: AIBlock | undefined,
  env: Record<string, string | undefined>,
): DiagnosticCheck {
  if (!ai || ai.enabled === false || ai.provider === undefined) {
    return disabled('disabled (optional; enable with "flowlens init --ai")');
  }
  let provider;
  try {
    provider = parseAIProvider(ai.provider);
  } catch (err) {
    return { ...BASE, status: 'error', message: (err as Error).message };
  }
  const model = ai.model || DEFAULT_MODELS[provider];
  const keyEnv = ai.api_key_env || DEFAULT_API_KEY_ENV[provider];
  if (keyEnv && !env[keyEnv]) {
    return {
      ...BASE,
      status: 'warning',
      message: `AI provider ${provider} (${model}) enabled but ${keyEnv} is not set`,
    };
  }
  return { ...BASE, status: 'ok', message: `AI provider: ${provider} (${model})` };
}

function disabled(message: string): DiagnosticCheck {
  return { ...BASE, status: 'skipped', message };
}
