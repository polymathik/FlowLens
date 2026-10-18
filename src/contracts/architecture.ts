export interface ArchitectureLayer {
  name: string;
  include: {
    patterns?: string[];
    files?: string[];
    entities?: string[];
  };
  may_only_access?: string[];
  must_not_access?: string[];
}

export interface ArchitectureConfig {
  version: 2;
  inferred_by: 'heuristic' | 'ai:anthropic' | 'ai:openai' | 'ai:ollama' | 'manual';
  inferred_at: string;
  layers: ArchitectureLayer[];
}
