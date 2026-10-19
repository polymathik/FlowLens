import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeHookInput, ClaudeHookOutput } from '../../../src/contracts/agent.js';
import { runAgentGate } from '../../../src/agent/run-gate.js';
import { runAgentRecord } from '../../../src/agent/run-record.js';
import { DIGEST_VERSION } from '../../../src/agent/digest.js';
import {
  appendLogEvent, ledgerPath, listLedgerSessions, parseLog, pruneLedgers, readSessionLog, safeSessionId,
} from '../../../src/agent/ledger.js';

const SESSION = 'sess-1';
const CORE = 'packages/core/src/session.ts';

describe('agent gate, recorder and ledger', () => {
  let root: string;
  let fl: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'flowlens-gate-'));
    fl = join(root, '.flowlens');
    await mkdir(fl, { recursive: true });
    await mkdir(join(root, 'packages/core/src'), { recursive: true });
    await mkdir(join(root, 'src'), { recursive: true });
    for (const f of [CORE, 'src/hot.ts', 'src/small.ts']) await writeFile(join(root, f), '// x\n');
    await writeFile(join(fl, 'agent.json'), JSON.stringify({ gate: { paths: ['packages/core/**'] } }));
    await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { flowlens: { command: 'npx', args: ['--no-install', 'flowlens', 'serve'] } } }));
    const row = (id: string, kind: string, name: string, file: string, afferent: number) =>
      [id, kind, name, name, file, 0, 0, 'typescript', 0, 0, 0, 0, afferent];
    await writeFile(join(fl, 'agent-digest.json'), JSON.stringify({
      version: DIGEST_VERSION, fingerprint: 'f', computed_at: '', summary: { entity_count: 0, relation_count: 0, languages: {} },
      hotspots: [{ file: 'src/hot.ts' }], cycles: [], cycle_count: 0, violations: [], violation_count: 0, cycle_keys: [], violation_ids: [],
      entities: [row('1', 'function', 'hotFn', 'src/hot.ts', 9), row('2', 'function', 'other', 'src/hot.ts', 2)], edges: [], warnings: [],
    }));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const edit = (file: string, tool = 'Edit'): ClaudeHookInput => ({
    hook_event_name: 'PreToolUse', session_id: SESSION, tool_name: tool, tool_input: { file_path: join(root, file) },
  });
  const gate = (file: string, env: NodeJS.ProcessEnv = {}) => runAgentGate({ rootDir: root, hookInput: edit(file), env });
  const parse = (stdout: string): ClaudeHookOutput => JSON.parse(stdout);
  const query = (file: string, tool = 'mcp__flowlens__get_dependents') => runAgentRecord(root, {
    hook_event_name: 'PostToolUse', session_id: SESSION, tool_name: tool,
    tool_response: { content: [{ type: 'text', text: JSON.stringify({ data: { entity: { file } } }) }] },
  });

  it('denies an unchecked protected file with the exact tool to call, naming nothing it cannot know', async () => {
    const out = await gate(CORE);
    expect(out.exit_code).toBe(0);
    const hook = parse(out.stdout).hookSpecificOutput!;
    expect(hook).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    expect(hook.permissionDecisionReason).toContain(CORE);
    expect(hook.permissionDecisionReason).toContain('mcp__flowlens__get_dependents');
  });

  it('names the most depended-on symbols for a hotspot', async () => {
    const reason = parse((await gate('src/hot.ts')).stdout).hookSpecificOutput!.permissionDecisionReason!;
    expect(reason).toContain('Symbols in it: hotFn, other.');
  });

  it('allows the edit once the recorder saw a query for that file, and logs both', async () => {
    expect((await gate(CORE)).stdout).not.toBe('');
    await query(CORE);
    expect((await gate(CORE)).stdout).toBe('');
    const log = await readSessionLog(fl, SESSION);
    expect(log.filter((e) => e.t === 'gate').map((e) => (e as { decision: string }).decision)).toEqual(['deny', 'allow']);
    expect(log.find((e) => e.t === 'query')).toMatchObject({ tool: 'get_dependents', files: [CORE] });
  });

  it('does not slow or log files that are not gated; new files and other tools pass', async () => {
    expect((await gate('src/small.ts')).stdout).toBe('');
    expect((await gate('packages/core/src/brand-new.ts')).stdout).toBe('');
    expect((await runAgentGate({ rootDir: root, hookInput: { ...edit(CORE), tool_name: 'Bash' } })).stdout).toBe('');
    expect(await readSessionLog(fl, SESSION)).toEqual([]);
  });

  it('a query for a different file does not unlock this one', async () => {
    await query('src/small.ts');
    expect((await gate(CORE)).stdout).not.toBe('');
    await query(CORE, 'mcp__flowlens__search_entities');
    expect((await gate(CORE)).stdout).not.toBe('');
  });

  it('fails open when the FlowLens MCP server is known to be missing', async () => {
    await rm(join(root, '.mcp.json'));
    expect((await gate(CORE)).stdout).toBe('');
    expect(await readSessionLog(fl, SESSION)).toEqual([]);
  });

  it('fails open: env off, disabled config, known-missing MCP, malformed input, missing session', async () => {
    expect((await gate(CORE, { FLOWLENS_GATE: 'off' })).stdout).toBe('');
    expect((await runAgentGate({ rootDir: root, hookInput: { ...edit(CORE), session_id: undefined } })).stdout).toBe('');
    expect((await runAgentGate({ rootDir: join(root, 'nowhere'), hookInput: edit(CORE) })).stdout).toBe('');
    expect((await runAgentGate({ rootDir: root, hookInput: { hook_event_name: 'PreToolUse', session_id: SESSION } as ClaudeHookInput })).stdout).toBe('');
    await writeFile(join(fl, 'agent.json'), JSON.stringify({ gate: { enabled: false } }));
    expect((await gate(CORE)).stdout).toBe('');
  });

  it('relents with a visible message after max_denials, then keeps allowing', async () => {
    for (let i = 0; i < 3; i++) expect(parse((await gate(CORE)).stdout).hookSpecificOutput?.permissionDecision).toBe('deny');
    const relented = parse((await gate(CORE)).stdout);
    expect(relented.hookSpecificOutput).toBeUndefined();
    expect(relented.systemMessage).toContain('after 3 blocked attempts');
    expect(relented.systemMessage).toContain(CORE);
  });

  it('gates every file of an apply_patch and reports them together', async () => {
    const patch = `*** Begin Patch\n*** Update File: ${CORE}\n*** Update File: src/small.ts\n*** End Patch`;
    const out = await runAgentGate({ rootDir: root, hookInput: { ...edit(CORE, 'apply_patch'), tool_input: { command: patch } }, env: {} });
    const reason = parse(out.stdout).hookSpecificOutput!.permissionDecisionReason!;
    expect(reason).toContain(CORE);
    expect(reason).not.toContain('src/small.ts');
  });

  describe('recorder', () => {
    it('ignores non-FlowLens tools and missing sessions, and never throws', async () => {
      expect((await runAgentRecord(root, { hook_event_name: 'PostToolUse', session_id: SESSION, tool_name: 'Read' })).stdout).toBe('');
      expect((await runAgentRecord(root, { hook_event_name: 'PostToolUse', tool_name: 'mcp__flowlens__get_context' })).exit_code).toBe(0);
      expect((await runAgentRecord(join(root, 'nowhere'), { hook_event_name: 'PostToolUse', session_id: SESSION, tool_name: 'mcp__flowlens__get_context' })).exit_code).toBe(0);
      expect(existsSync(ledgerPath(fl, SESSION)!)).toBe(false);
    });

    it('logs tools that credit no file, with the response size', async () => {
      await runAgentRecord(root, { hook_event_name: 'PostToolUse', session_id: SESSION, tool_name: 'mcp__flowlens__search_entities', tool_response: 'abcde' });
      expect(await readSessionLog(fl, SESSION)).toMatchObject([{ t: 'query', tool: 'search_entities', files: [], response_chars: 5 }]);
    });
  });

  describe('ledger', () => {
    it('makes session ids filename-safe and refuses empty ones', () => {
      expect(safeSessionId('a/b\\..c')).toBe('a_b_..c');
      expect(safeSessionId('..')).toBeNull();
      expect(safeSessionId(undefined)).toBeNull();
      expect(ledgerPath(fl, '../../etc/passwd')!.startsWith(join(fl, 'agent-ledger'))).toBe(true);
    });

    it('skips torn and foreign lines when reading', () => {
      const ok = JSON.stringify({ t: 'session', ts: 'x', session_id: 's', source: 'startup' });
      expect(parseLog(`${ok}\n{"t":"que\nnot json\n${JSON.stringify({ t: 1 })}\n\n`)).toHaveLength(1);
    });

    it('prunes only ledgers older than the retention window', async () => {
      await appendLogEvent(fl, { t: 'session', ts: 'x', session_id: 'old', source: 'startup' } as never);
      await appendLogEvent(fl, { t: 'session', ts: 'x', session_id: 'new', source: 'startup' } as never);
      const old = new Date(Date.now() - 30 * 86_400_000);
      await utimes(ledgerPath(fl, 'old')!, old, old);
      expect(await pruneLedgers(fl)).toBe(1);
      expect((await listLedgerSessions(fl)).map((s) => s.session_id)).toEqual(['new']);
      expect(await readFile(ledgerPath(fl, 'new')!, 'utf-8')).toContain('"session_id":"new"');
    });

    it('survives parallel appends without tearing lines', async () => {
      await Promise.all(Array.from({ length: 40 }, (_, i) => appendLogEvent(fl, {
        t: 'query', ts: 'x', session_id: 'par', tool: 'get_context', files: [`f${i}.ts`], response_chars: i,
      })));
      expect(await readSessionLog(fl, 'par')).toHaveLength(40);
    });
  });
});
