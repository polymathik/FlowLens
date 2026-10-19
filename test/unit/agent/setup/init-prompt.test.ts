import { describe, expect, it } from 'vitest';
import type { AgentSetupRequest, AgentSetupResult } from '../../../../src/contracts/agent-setup.js';
import { NEXT_HINT, connectAgentsAfterInit, parseAgentList, type PromptIo } from '../../../../src/agent/setup/prompt.js';

function io(over: Partial<PromptIo> & { answers?: string[] } = {}): { io: PromptIo; out: string[]; warns: string[]; reqs: AgentSetupRequest[]; asked: string[] } {
  const out: string[] = []; const warns: string[] = []; const reqs: AgentSetupRequest[] = []; const asked: string[] = [];
  const answers = [...(over.answers ?? [])];
  return {
    out, warns, reqs, asked,
    io: {
      interactive: false,
      ask: async (q) => { asked.push(q); return answers.shift() ?? ''; },
      log: (l) => out.push(l), warn: (l) => warns.push(l),
      codexDetected: () => false,
      setup: async (req) => { reqs.push(req); return req.providers.map((provider): AgentSetupResult => ({ provider, notes: [], mcp: { provider, method: 'mcp-json', scope: req.scope, changed: true, command: 'x' } })); },
      ...over,
    },
  };
}

describe('connectAgentsAfterInit', () => {
  it('prints only the hint when not interactive and no flags', async () => {
    const t = io();
    await connectAgentsAfterInit('/p', {}, t.io);
    expect(t.reqs).toEqual([]);
    expect(t.out.join('\n')).toContain(NEXT_HINT);
  });

  it('--no-agent is silent', async () => {
    const t = io({ interactive: true });
    await connectAgentsAfterInit('/p', { agent: false, yes: true }, t.io);
    expect(t.out).toEqual([]);
    expect(t.reqs).toEqual([]);
  });

  it('--yes connects Claude Code without asking; --shared selects team scope; --agents chooses', async () => {
    const a = io({ interactive: true });
    await connectAgentsAfterInit('/p', { yes: true }, a.io);
    expect(a.asked).toEqual([]);
    expect(a.reqs.map((r) => [r.providers, r.scope])).toEqual([[['claude-code'], 'local']]);
    const b = io();
    await connectAgentsAfterInit('/p', { yes: true, shared: true, agents: 'claude-code,codex' }, b.io);
    expect(b.reqs.map((r) => [r.providers, r.scope])).toEqual([[['claude-code'], 'shared'], [['codex'], 'shared']]);
  });

  it('interactive: explains, asks Claude Code, asks Codex only when detected', async () => {
    const a = io({ interactive: true, answers: ['', 'n'], codexDetected: () => true });
    await connectAgentsAfterInit('/p', {}, a.io);
    expect(a.asked).toEqual(['Connect Claude Code? [Y/n] ', 'Connect Codex? [Y/n] ']);
    expect(a.out.join('\n')).toMatch(/registers the FlowLens MCP server for you only/);
    expect(a.reqs.map((r) => r.providers)).toEqual([['claude-code']]);
    const b = io({ interactive: true, answers: ['n'] });
    await connectAgentsAfterInit('/p', {}, b.io);
    expect(b.asked).toEqual(['Connect Claude Code? [Y/n] ']);
    expect(b.reqs).toEqual([]);
  });

  it('a setup failure only warns, with the manual command', async () => {
    const t = io({ setup: async () => { throw new Error('disk on fire'); } });
    await expect(connectAgentsAfterInit('/p', { yes: true }, t.io)).resolves.toBeUndefined();
    expect(t.warns.join(' ')).toContain('flowlens agent install claude-code');
    const u = io({ setup: async (r) => [{ provider: r.providers[0], notes: ['x'] }] });
    await connectAgentsAfterInit('/p', { yes: true }, u.io);
    expect(u.warns.join(' ')).toContain('was not connected');
  });

  it('parseAgentList rejects unknown agents and dedupes', () => {
    expect(parseAgentList('codex, claude-code,codex')).toEqual(['codex', 'claude-code']);
    expect(() => parseAgentList('cursor')).toThrow(/Unknown agent "cursor"/);
    expect(() => parseAgentList('')).toThrow();
  });
});
