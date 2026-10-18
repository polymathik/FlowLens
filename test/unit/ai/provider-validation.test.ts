/**
 * Phase 10 AI fixes: per-provider `inferred_by` labels and strict
 * provider validation (invalid provider = configuration error).
 */
import { describe, it, expect } from 'vitest';
import {
  createAIIntegration,
  parseAIProvider,
  responseToArchitectureConfig,
  runInference,
} from '../../../src/ai/ai-integration.js';
import { AI_PROVIDERS, AIConfigError } from '../../../src/contracts/ai-integration.js';
import type { AIProvider, AIProviderConfig } from '../../../src/contracts/ai-integration.js';

const RESPONSE = { layers: [{ name: 'Core', description: '', include: {} }], reasoning: '' };

describe('responseToArchitectureConfig inferred_by', () => {
  it.each<[AIProvider, string]>([
    ['anthropic', 'ai:anthropic'],
    ['openai', 'ai:openai'],
    ['ollama', 'ai:ollama'],
  ])('%s → %s', (provider, label) => {
    expect(responseToArchitectureConfig(RESPONSE, provider).inferred_by).toBe(label);
  });
});

describe('parseAIProvider', () => {
  it('accepts every supported provider', () => {
    for (const p of AI_PROVIDERS) expect(parseAIProvider(p)).toBe(p);
  });

  it.each(['bogus', 'OpenAI', '', undefined, 42])('rejects %p with AIConfigError', (value) => {
    expect(() => parseAIProvider(value)).toThrow(AIConfigError);
  });

  it('names the valid options in the message', () => {
    expect(() => parseAIProvider('gpt')).toThrow(/anthropic, openai, ollama/);
  });
});

describe('invalid provider is a config error, not a silent fallback', () => {
  const bogus = { provider: 'bogus' } as unknown as AIProviderConfig;

  it('createAIIntegration throws AIConfigError', () => {
    expect(() => createAIIntegration(bogus)).toThrow(AIConfigError);
  });

  it('runInference rethrows AIConfigError instead of returning ok:false', async () => {
    const request = {
      topology: { clusters: [], total_entities: 0, total_relations: 0, languages: {} },
    };
    await expect(runInference(bogus, request)).rejects.toBeInstanceOf(AIConfigError);
  });
});
