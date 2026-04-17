/**
 * OpenAI chat-completions provider. Uses the `openai` package via dynamic
 * import — optional peer dependency, same rationale as the Anthropic provider.
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

export class OpenAIProvider implements AIIntegration {
  readonly provider = 'openai' as const;
  private readonly model: string;
  private readonly apiKeyEnv: string;

  constructor(config: AIProviderConfig) {
    this.model = config.model ?? DEFAULT_MODELS.openai;
    this.apiKeyEnv = config.apiKeyEnv ?? DEFAULT_API_KEY_ENV.openai;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const key = process.env[this.apiKeyEnv];
    if (!key) {
      return { available: false, error: `env var ${this.apiKeyEnv} not set` };
    }
    try {
      await loadSdk();
      return { available: true };
    } catch (err) {
      return {
        available: false,
        error: `openai package not installed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async inferArchitecture(
    request: AIInferenceRequest,
  ): Promise<AIInferenceResponse> {
    const OpenAI = await loadSdk();
    const client = new OpenAI();
    const prompt = buildPrompt(request);
    const response = await client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.choices?.[0]?.message?.content ?? '';
    const parsed = tryParseJson(text);
    if (!parsed) {
      throw new Error('OpenAI response did not contain valid JSON');
    }
    return parsed;
  }
}

type OpenAICtor = new () => {
  chat: {
    completions: {
      create(args: unknown): Promise<{
        choices: Array<{ message: { content: string | null } }>;
      }>;
    };
  };
};

async function loadSdk(): Promise<OpenAICtor> {
  // @ts-expect-error — optional peer dependency not installed in bare installs
  const mod = (await import('openai')) as { default: OpenAICtor };
  return mod.default;
}
