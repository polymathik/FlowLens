/**
 * Phase 10 doctor fixes: the MCP check really constructs the server and
 * lists tools in-process; the AI check reports `skipped` when disabled.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runIndex } from '../../../src/indexer/indexer.js';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import {
  EXPECTED_MCP_TOOLS,
  mcpReachableCheck,
  toolsResult,
} from '../../../src/doctor/checks/mcp-check.js';
import { aiConfiguredCheck, evaluateAIBlock } from '../../../src/doctor/checks/ai-check.js';
import { DefaultDoctor } from '../../../src/doctor/doctor.js';
import type { FlowLensConfig } from '../../../src/contracts/config.js';

const FIXTURE = resolve(import.meta.dirname, '../../fixtures/simple-project');
const CONFIG: FlowLensConfig = {
  exclude: [],
  languages: { typescript: true, javascript: true },
  ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
};

describe('mcpReachableCheck (real server, indexed fixture)', () => {
  let tmp: string;
  let ctx: { rootDir: string; flowlensDir: string; daemon: boolean };

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'flowlens-doctor-mcp-'));
    const flowlensDir = join(tmp, '.flowlens');
    await mkdir(flowlensDir, { recursive: true });
    await writeFile(join(flowlensDir, 'config.json'), JSON.stringify(CONFIG));
    const store = new LevelGraphStore();
    await store.open(join(flowlensDir, 'graph'));
    await runIndex({
      rootDir: FIXTURE,
      graphStore: store,
      config: CONFIG,
      fileIndexPath: join(flowlensDir, 'file_index.json'),
      incremental: false,
    });
    await store.close();
    ctx = { rootDir: FIXTURE, flowlensDir, daemon: false };
  }, 60_000);

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('starts the MCP server in-process and lists all 14 tools', async () => {
    const result = await mcpReachableCheck(ctx);
    expect(result.status).toBe('ok');
    expect(result.message).toContain('14 tools listed');
    for (const tool of EXPECTED_MCP_TOOLS) expect(result.details).toContain(tool);
  });

  it('warns (not errors) when another process holds the graph lock', async () => {
    const holder = new LevelGraphStore();
    await holder.open(join(ctx.flowlensDir, 'graph'));
    try {
      const result = await mcpReachableCheck(ctx);
      expect(result.status).toBe('warning');
      expect(result.message).toMatch(/locked by another FlowLens process.*--no-daemon/);
    } finally {
      await holder.close();
    }
  });

  it('errors when the graph is missing', async () => {
    const result = await mcpReachableCheck({ rootDir: tmp, flowlensDir: join(tmp, 'nope') });
    expect(result.status).toBe('error');
  });
});

describe('toolsResult', () => {
  it('errors and names missing tools', () => {
    const r = toolsResult(['get_context']);
    expect(r.status).toBe('error');
    expect(r.details).toContain('traverse');
  });
});

describe('AI check', () => {
  it('reports skipped/disabled when ai.enabled is false', () => {
    const r = evaluateAIBlock({ enabled: false, provider: 'anthropic' }, {});
    expect(r.status).toBe('skipped');
    expect(r.message).toMatch(/disabled/);
  });

  it('reports skipped when no ai block exists', () => {
    expect(evaluateAIBlock(undefined, {}).status).toBe('skipped');
  });

  it('errors on an unknown provider', () => {
    const r = evaluateAIBlock({ enabled: true, provider: 'bogus' }, {});
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/Unknown AI provider "bogus"/);
  });

  it('warns when the API key env var is missing', () => {
    const r = evaluateAIBlock({ enabled: true, provider: 'openai' }, {});
    expect(r.status).toBe('warning');
    expect(r.message).toContain('OPENAI_API_KEY');
  });

  it('is ok when enabled with a key (ollama needs none)', () => {
    expect(evaluateAIBlock({ enabled: true, provider: 'openai' }, { OPENAI_API_KEY: 'x' }).status).toBe('ok');
    expect(evaluateAIBlock({ enabled: true, provider: 'ollama' }, {}).status).toBe('ok');
  });

  it('a skipped check never affects the overall status', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'flowlens-doctor-ai-'));
    try {
      await mkdir(join(tmp, '.flowlens'));
      await writeFile(join(tmp, '.flowlens', 'config.json'), JSON.stringify(CONFIG));
      const report = await new DefaultDoctor({ checks: [aiConfiguredCheck] }).diagnose(tmp);
      expect(report.checks[0].status).toBe('skipped');
      expect(report.overall).toBe('ok');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
