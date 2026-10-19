import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_AGENT_GATE, type AgentGateConfig } from '../../../src/contracts/agent-setup.js';
import { decideGate, denyReason, matchesAny, type GateInput } from '../../../src/agent/gate.js';
import { loadAgentConfig, parseAgentConfig } from '../../../src/agent/agent-config.js';

const config = (over: Partial<AgentGateConfig> = {}): AgentGateConfig => ({ ...DEFAULT_AGENT_GATE, paths: ['packages/core/**'], ...over });
const input = (over: Partial<GateInput> = {}): GateInput => ({
  file: 'packages/core/src/session.ts',
  exists: true,
  config: config(),
  hotspotFiles: new Set(['src/hot.ts']),
  queried: new Set(),
  denials: 0,
  envOff: false,
  mcp: 'unknown',
  ...over,
});

describe('decideGate', () => {
  it('denies an unchecked file in a protected path, and a hotspot', () => {
    expect(decideGate(input())).toEqual({ verdict: 'deny', why: 'path' });
    expect(decideGate(input({ file: 'src/hot.ts' }))).toEqual({ verdict: 'deny', why: 'hotspot' });
  });

  it('allows once FlowLens was queried for the file', () => {
    expect(decideGate(input({ queried: new Set(['packages/core/src/session.ts']) }))).toEqual({ verdict: 'allow', why: 'checked' });
  });

  it('allows files that are not gated, excluded, or new', () => {
    expect(decideGate(input({ file: 'src/small.ts' })).why).toBe('not_gated');
    expect(decideGate(input({ file: 'packages/core/src/session.test.ts' })).why).toBe('not_gated');
    expect(decideGate(input({ file: 'packages/core/README.md' })).why).toBe('not_gated');
    expect(decideGate(input({ exists: false })).why).toBe('new_file');
  });

  it('fails open: disabled, env off, MCP known missing', () => {
    expect(decideGate(input({ config: config({ enabled: false }) })).why).toBe('disabled');
    expect(decideGate(input({ envOff: true })).why).toBe('disabled');
    expect(decideGate(input({ mcp: 'not_connected' })).why).toBe('unavailable');
    expect(decideGate(input({ mcp: 'connected' })).verdict).toBe('deny');
  });

  it('relents after max_denials of the same file; 0 means never relent', () => {
    expect(decideGate(input({ denials: 2 })).verdict).toBe('deny');
    expect(decideGate(input({ denials: 3 }))).toEqual({ verdict: 'relent', why: 'path' });
    expect(decideGate(input({ denials: 50, config: config({ max_denials: 0 }) })).verdict).toBe('deny');
  });

  it('matches dotfiles and nested paths', () => {
    expect(matchesAny('packages/core/.hidden/a.ts', ['packages/core/**'])).toBe(true);
    expect(matchesAny('src/a.ts', ['packages/core/**'])).toBe(false);
  });
});

describe('denyReason', () => {
  it('names the file, the symbols and the exact tool call that clears it', () => {
    const text = denyReason([{ file: 'packages/core/src/session.ts', why: 'path', symbols: ['Session', 'open'] }]);
    expect(text).toContain('packages/core/src/session.ts');
    expect(text).toContain('Symbols in it: Session, open.');
    expect(text).toContain('mcp__flowlens__get_dependents');
    expect(text).toContain('mcp__flowlens__get_context with "packages/core/src/session.ts"');
    expect(text).toContain('tell the user');
  });

  it('describes hotspots and omits the symbol line when there are none', () => {
    const text = denyReason([{ file: 'src/hot.ts', why: 'hotspot', symbols: [] }]);
    expect(text).toContain('hotspot');
    expect(text).not.toContain('Symbols in it');
  });
});

describe('parseAgentConfig', () => {
  it('merges a partial gate over the defaults', () => {
    const parsed = parseAgentConfig({ version: 1, gate: { paths: ['a/**'], hotspots: 3 } });
    expect(parsed).toEqual({ config: { ...DEFAULT_AGENT_GATE, paths: ['a/**'], hotspots: 3 } });
    expect(parseAgentConfig({})).toEqual({ config: DEFAULT_AGENT_GATE });
  });

  it.each([
    [[], 'object'],
    [{ version: 2 }, 'version'],
    [{ gate: 'x' }, '"gate"'],
    [{ gate: { enabled: 'yes' } }, 'gate.enabled'],
    [{ gate: { paths: 'a' } }, 'gate.paths'],
    [{ gate: { exclude: [1] } }, 'gate.exclude'],
    [{ gate: { hotspots: -1 } }, 'gate.hotspots'],
    [{ gate: { max_denials: 1.5 } }, 'gate.max_denials'],
  ])('rejects %j', (value, fragment) => {
    const parsed = parseAgentConfig(value);
    expect('error' in parsed && parsed.error).toContain(fragment);
  });
});

describe('loadAgentConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'flowlens-agentcfg-'));
    await mkdir(dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns defaults without a file, the parsed file when valid, defaults plus an error when not', async () => {
    expect(await loadAgentConfig(dir)).toEqual({ config: DEFAULT_AGENT_GATE, path: null });
    await writeFile(join(dir, 'agent.json'), JSON.stringify({ gate: { paths: ['x/**'] } }));
    expect((await loadAgentConfig(dir)).config.paths).toEqual(['x/**']);
    await writeFile(join(dir, 'agent.json'), '{ nope');
    const bad = await loadAgentConfig(dir);
    expect(bad.config).toEqual(DEFAULT_AGENT_GATE);
    expect(bad.error).toContain('not valid JSON');
    await writeFile(join(dir, 'agent.json'), JSON.stringify({ gate: { enabled: 1 } }));
    expect((await loadAgentConfig(dir)).error).toContain('gate.enabled');
  });
});
