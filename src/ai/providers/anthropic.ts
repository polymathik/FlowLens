/**
 * Anthropic Messages API provider. Uses @anthropic-ai/sdk via dynamic
 * import — the package is an optional peer dependency; users who don't
 * use --ai don't pay the install cost.
 */
import type {
  AIIntegration,
  AIInferenceRequest,
  AIInferenceResponse,
  AIProviderConfig,
  HealthCheckResult,
} from '../../contracts/ai-integration.js';
import {
  DEFAULT_MODELS,
  DEFAULT_API_KEY_ENV,
} from '../../contracts/ai-integration.js';
import { buildPrompt, tryParseJson } from '../prompt-builder.js';

export class AnthropicProvider implements AIIntegration {
  readonly provider = 'anthropic' as const;
  private readonly model: string;
  private readonly apiKeyEnv: string;

  constructor(config: AIProviderConfig) {
    this.model = config.model ?? DEFAULT_MODELS.anthropic;
    this.apiKeyEnv = config.apiKeyEnv ?? DEFAULT_API_KEY_ENV.anthropic;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const key = process.env[this.apiKeyEnv];
    if (!key) {
      return {
        available: false,
        error: `env var ${this.apiKeyEnv} not set`,
      };
    }
    try {
      await loadSdk();
      return { available: true };
    } catch (err) {
      return {
        available: false,
        error: `@anthropic-ai/sdk not installed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async inferArchitecture(
    request: AIInferenceRequest,
  ): Promise<AIInferenceResponse> {
    const Anthropic = await loadSdk();
    const client = new Anthropic();
    const prompt = buildPrompt(request);
    const response = await client.messages.create({
      model: this.model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = extractText(response);
    const parsed = tryParseJson(text);
    if (!parsed) {
      throw new Error('Anthropic response did not contain valid JSON');
    }
    return parsed;
  }
}

type AnthropicCtor = new () => {
  messages: { create(args: unknown): Promise<{ content: Array<{ type: string; text?: string }> }> };
};

async function loadSdk(): Promise<AnthropicCtor> {
  // @ts-expect-error — optional peer dependency not installed in bare installs
  const mod = (await import('@anthropic-ai/sdk')) as { default: AnthropicCtor };
  return mod.default;
}

function extractText(response: { content: Array<{ type: string; text?: string }> }): string {
  const textBlocks = response.content.filter((b) => b.type === 'text');
  return textBlocks.map((b) => b.text ?? '').join('\n');
}
