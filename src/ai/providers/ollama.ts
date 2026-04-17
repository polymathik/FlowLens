/**
 * Ollama local-model provider. Hits a local Ollama server via plain fetch
 * — no npm dependency. Privacy win: everything stays on the user's box.
 */
import type {
  AIIntegration,
  AIInferenceRequest,
  AIInferenceResponse,
  AIProviderConfig,
  HealthCheckResult,
} from '../../contracts/ai-integration.js';
import { DEFAULT_MODELS } from '../../contracts/ai-integration.js';
import { buildPrompt, tryParseJson } from '../prompt-builder.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';

export class OllamaProvider implements AIIntegration {
  readonly provider = 'ollama' as const;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: AIProviderConfig) {
    this.model = config.model ?? DEFAULT_MODELS.ollama;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
      if (!res.ok) {
        return { available: false, error: `ollama returned ${res.status}` };
      }
      return { available: true };
    } catch (err) {
      return {
        available: false,
        error: `cannot reach ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async inferArchitecture(
    request: AIInferenceRequest,
  ): Promise<AIInferenceResponse> {
    const prompt = buildPrompt(request);
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, stream: false }),
    });
    if (!res.ok) {
      throw new Error(`ollama returned ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { response?: string };
    const parsed = tryParseJson(body.response ?? '');
    if (!parsed) {
      throw new Error('Ollama response did not contain valid JSON');
    }
    return parsed;
  }
}
