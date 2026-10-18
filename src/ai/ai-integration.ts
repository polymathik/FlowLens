/**
 * AI integration facade — chooses a provider implementation, builds a
 * topology request from the graph, invokes the provider, and converts the
 * response into an `ArchitectureConfig` suitable for `.flowlens/`.
 *
 * Callers use this from `flowlens init --ai`. If the provider fails at
 * any stage, the caller should fall back to the heuristic inference —
 * we surface that as a typed result rather than throwing.
 */
import { AI_PROVIDERS, AIConfigError } from '../contracts/ai-integration.js';
import type {
  AIIntegration,
  AIInferenceRequest,
  AIInferenceResponse,
  AIProviderConfig,
  AIProvider,
} from '../contracts/ai-integration.js';
import type { ArchitectureConfig } from '../contracts/architecture.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { OllamaProvider } from './providers/ollama.js';

/**
 * Validate a user-supplied provider name (CLI flag or config file).
 * Throws `AIConfigError` for anything not in `AI_PROVIDERS`.
 */
export function parseAIProvider(value: unknown): AIProvider {
  if (typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value)) {
    return value as AIProvider;
  }
  throw new AIConfigError(
    `Unknown AI provider "${String(value)}". Use one of: ${AI_PROVIDERS.join(', ')}.`,
  );
}

export function createAIIntegration(config: AIProviderConfig): AIIntegration {
  parseAIProvider(config.provider);
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default: {
      const exhaustive: never = config.provider;
      throw new AIConfigError(`unknown AI provider: ${String(exhaustive)}`);
    }
  }
}

const INFERRED_BY: Record<AIProvider, ArchitectureConfig['inferred_by']> = {
  anthropic: 'ai:anthropic',
  openai: 'ai:openai',
  ollama: 'ai:ollama',
};

/** Map an AIInferenceResponse into the architecture.json v2 shape. */
export function responseToArchitectureConfig(
  response: AIInferenceResponse,
  provider: AIProvider,
): ArchitectureConfig {
  return {
    version: 2,
    inferred_by: INFERRED_BY[provider],
    inferred_at: new Date().toISOString(),
    layers: response.layers.map((l) => ({
      name: l.name,
      include: l.include ?? {},
      may_only_access: l.may_only_access,
      must_not_access: l.must_not_access,
    })),
  };
}

export type InferenceOutcome =
  | { ok: true; response: AIInferenceResponse; config: ArchitectureConfig }
  | { ok: false; error: string };

/**
 * Run inference end-to-end, catching any failure (SDK not installed, API
 * error, unparseable response) and returning it as a typed error so the
 * caller can decide to fall back to heuristic inference.
 */
export async function runInference(
  config: AIProviderConfig,
  request: AIInferenceRequest,
): Promise<InferenceOutcome> {
  try {
    const integration = createAIIntegration(config);
    const health = await integration.healthCheck();
    if (!health.available) {
      return { ok: false, error: health.error ?? 'provider unavailable' };
    }
    const response = await integration.inferArchitecture(request);
    return {
      ok: true,
      response,
      config: responseToArchitectureConfig(response, config.provider),
    };
  } catch (err) {
    // Configuration mistakes are the caller's to report (exit 2), not a
    // provider failure to paper over with the heuristic fallback.
    if (err instanceof AIConfigError) throw err;
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
