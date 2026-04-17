import { describe, it, expect } from 'vitest';
import { buildTopology } from '../../../src/ai/topology-builder.js';
import { buildPrompt, tryParseJson } from '../../../src/ai/prompt-builder.js';
import {
  createAIIntegration,
  responseToArchitectureConfig,
} from '../../../src/ai/ai-integration.js';
import type { Entity } from '../../../src/contracts/entities.js';
import type { Relation } from '../../../src/contracts/relations.js';

function file(id: string, path: string, lang: string = 'typescript'): Entity {
  return {
    id,
    kind: 'file',
    name: path.split('/').pop() ?? path,
    qualified_name: path,
    file: path,
    location: { line_start: 0, line_end: 0, column_start: 0, column_end: 0 },
    visibility: 'public',
    language: lang,
  };
}

function rel(id: string, from: string, to: string, type: Relation['type'] = 'import'): Relation {
  return {
    id,
    from,
    to,
    type,
    location: { file: '', line: 0, column: 0 },
    weight: 1,
    confidence: 1,
  };
}

describe('buildTopology (privacy)', () => {
  const entities = [
    file('f1', 'src/auth/Login.ts'),
    file('f2', 'src/auth/Session.ts'),
    file('f3', 'src/db/UserRepo.ts'),
    file('f4', 'test/auth/login.test.ts'),
  ];
  const relations = [
    rel('r1', 'f1', 'f2'),
    rel('r2', 'f1', 'f3'),
    rel('r3', 'f4', 'f1'),
  ];

  it('groups files by top-level directory', () => {
    const request = buildTopology(entities, relations);
    const dirs = request.topology.clusters.map((c) => c.files[0].split('/')[0]);
    const unique = new Set(dirs);
    expect(unique).toContain('src');
    expect(unique).toContain('test');
  });

  it('counts internal vs external edges per cluster', () => {
    const request = buildTopology(entities, relations);
    const srcCluster = request.topology.clusters.find((c) =>
      c.files.every((f) => f.startsWith('src/')),
    );
    expect(srcCluster).toBeDefined();
    // src/auth→src/auth (internal) + src/auth→src/db (external)
    expect(srcCluster!.internal_edge_count + srcCluster!.external_edge_count).toBeGreaterThan(0);
  });

  it('computes common prefixes per cluster', () => {
    // All src/ files share "src/" but not deeper
    const entities = [
      file('a', 'src/auth/a.ts'),
      file('b', 'src/db/b.ts'),
    ];
    const request = buildTopology(entities, []);
    const cluster = request.topology.clusters[0];
    expect(cluster.common_prefixes).toContain('src/');
    expect(cluster.common_prefixes).not.toContain('src/auth/');
  });

  it('counts entities and relations totals', () => {
    const request = buildTopology(entities, relations);
    expect(request.topology.total_entities).toBe(4);
    expect(request.topology.total_relations).toBe(3);
  });

  it('tracks language counts', () => {
    const mixed = [
      file('a', 'src/a.ts', 'typescript'),
      file('b', 'src/b.py', 'python'),
      file('c', 'src/c.ts', 'typescript'),
    ];
    const request = buildTopology(mixed, []);
    expect(request.topology.languages.typescript).toBe(2);
    expect(request.topology.languages.python).toBe(1);
  });

  it('NEVER contains source-code substrings from entity names', () => {
    // If privacy ever regressed — e.g. someone added `name` or `body` to
    // the topology shape — this test asserts that no entity name
    // (= potentially source-code identifier) leaks into the serialized
    // request.
    const sensitiveEntities = [
      {
        ...file('f1', 'src/secret.ts'),
        name: 'SECRET_INTERNAL_CLASS_NAME',
      },
      {
        ...file('f2', 'src/password.ts'),
        name: 'hashPasswordWithBcrypt',
      },
    ];
    const request = buildTopology(sensitiveEntities, []);
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain('SECRET_INTERNAL_CLASS_NAME');
    expect(serialized).not.toContain('hashPasswordWithBcrypt');
  });
});

describe('buildPrompt', () => {
  it('describes clusters and languages', () => {
    const request = buildTopology(
      [file('a', 'src/a.ts'), file('b', 'test/b.ts')],
      [],
    );
    const prompt = buildPrompt(request);
    expect(prompt).toContain('clusters detected');
    expect(prompt).toContain('typescript:');
    expect(prompt).toContain('Respond ONLY with a valid JSON');
  });
});

describe('tryParseJson', () => {
  it('parses clean JSON', () => {
    const r = tryParseJson('{"layers": [], "reasoning": "x"}');
    expect(r?.layers).toEqual([]);
  });

  it('strips ```json fences', () => {
    const r = tryParseJson('```json\n{"layers": [{"name":"A","description":"","include":{}}], "reasoning": "r"}\n```');
    expect(r?.layers).toHaveLength(1);
  });

  it('extracts JSON from surrounding prose', () => {
    const r = tryParseJson('Here you go: {"layers":[],"reasoning":"x"} — enjoy!');
    expect(r?.reasoning).toBe('x');
  });

  it('returns null for garbage', () => {
    expect(tryParseJson('not json at all')).toBeNull();
  });

  it('returns null for valid JSON missing the required shape', () => {
    expect(tryParseJson('{"not":"layers"}')).toBeNull();
  });
});

describe('createAIIntegration', () => {
  it('creates the Anthropic provider by default', () => {
    const integration = createAIIntegration({ provider: 'anthropic' });
    expect(integration.provider).toBe('anthropic');
  });

  it('creates the OpenAI provider', () => {
    const integration = createAIIntegration({ provider: 'openai' });
    expect(integration.provider).toBe('openai');
  });

  it('creates the Ollama provider', () => {
    const integration = createAIIntegration({ provider: 'ollama' });
    expect(integration.provider).toBe('ollama');
  });
});

describe('responseToArchitectureConfig', () => {
  it('maps AI response to v2 architecture.json', () => {
    const config = responseToArchitectureConfig(
      {
        layers: [
          {
            name: 'Auth',
            description: 'Authentication',
            include: { patterns: ['src/auth/**'] },
            may_only_access: ['Db'],
          },
        ],
        reasoning: 'because',
      },
      'anthropic',
    );
    expect(config.version).toBe(2);
    expect(config.inferred_by).toBe('ai:anthropic');
    expect(config.layers).toHaveLength(1);
    expect(config.layers[0].name).toBe('Auth');
    expect(config.layers[0].may_only_access).toEqual(['Db']);
  });
});

describe('Ollama healthCheck (offline path)', () => {
  it('reports unavailable when ollama is not reachable', async () => {
    const integration = createAIIntegration({
      provider: 'ollama',
      baseUrl: 'http://localhost:1', // port 1 reserved, never bound
    });
    const result = await integration.healthCheck();
    expect(result.available).toBe(false);
    expect(result.error).toMatch(/cannot reach/);
  });
});
