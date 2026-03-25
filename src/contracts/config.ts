export interface FlowLensConfig {
  exclude: string[];
  languages: Record<string, boolean>;
  ai: {
    enabled: boolean;
    provider: 'anthropic' | 'openai' | 'ollama';
    model: string;
    api_key_env: string;
  };
}
