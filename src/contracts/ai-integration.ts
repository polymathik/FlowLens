/**
 * AI integration contract — the boundary for `flowlens init --ai`.
 *
 * ==============================  PRIVACY  ==============================
 * The `AIInferenceRequest` contains ONLY graph topology: cluster sizes,
 * file paths, language counts, and edge-count aggregates. It never carries
 * source code, variable names outside file paths, docstrings, or any
 * content that could leak IP. This invariant is validated by tests in
 * `test/unit/ai/privacy.test.ts` — they assert that a built request's
 * serialized form doesn't contain substrings from the project's source
 * files.
 * =======================================================================
 */

export type AIProvider = 'anthropic' | 'openai' | 'ollama';

/** Topology-only representation of the graph for AI consumption. */
export interface AIInferenceRequest {
  topology: {
    clusters: Array<{
      /** Canonical file paths in this cluster. Paths only — no source code. */
      files: string[];
      internal_edge_count: number;
      external_edge_count: number;
      /** Common path prefixes shared by cluster members (e.g. "src/auth/"). */
      common_prefixes: string[];
    }>;
    total_entities: number;
    total_relations: number;
    /** Language → count (e.g. `{ typescript: 210, python: 42 }`). */
    languages: Record<string, number>;
  };
}

/** Layer definition returned by the AI, before validation. */
export interface AILayerSuggestion {
  name: string;
  description: string;
  include: {
    patterns?: string[];
    files?: string[];
    entities?: string[];
  };
  may_only_access?: string[];
  must_not_access?: string[];
}

export interface AIInferenceResponse {
  layers: AILayerSuggestion[];
  reasoning: string;
}

export interface AIProviderConfig {
  provider: AIProvider;
  /** Model identifier passed through to the provider. Provider-specific. */
  model?: string;
  /** Environment variable name holding the API key (default per provider). */
  apiKeyEnv?: string;
  /** Override base URL (Ollama in particular). */
  baseUrl?: string;
}

export interface HealthCheckResult {
  available: boolean;
  error?: string;
}

/**
 * Provider-agnostic interface. Each concrete provider (Anthropic, OpenAI,
 * Ollama) implements this and is constructed by the `createAIIntegration`
 * factory based on the `AIProviderConfig`.
 */
export interface AIIntegration {
  readonly provider: AIProvider;
  healthCheck(): Promise<HealthCheckResult>;
  inferArchitecture(request: AIInferenceRequest): Promise<AIInferenceResponse>;
}

/** Default models by provider. */
export const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  ollama: 'llama3',
};

/** Default env-var names holding API keys. */
export const DEFAULT_API_KEY_ENV: Record<AIProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  ollama: '',
};
