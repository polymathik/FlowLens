import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const FIXTURES = resolve(__dirname, '../../../fixtures/agent-stats');

/** A temp project with `.flowlens/`, plus a fake Claude config dir for transcripts. */
export function makeProject(): { root: string; flowlensDir: string; claudeHome: string; projectsRoot: string } {
  // Real path: the CLI subprocess sees its cwd canonicalised, and transcript dirs are named after it.
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'flowlens-stats-')));
  const root = join(base, 'my.proj_x');
  const flowlensDir = join(root, '.flowlens');
  mkdirSync(join(flowlensDir, 'agent-ledger'), { recursive: true });
  const claudeHome = join(base, 'claude-home');
  const projectsRoot = join(claudeHome, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  return { root, flowlensDir, claudeHome, projectsRoot };
}

export function copyLedger(flowlensDir: string, fixture: string, transcriptPath?: string): void {
  const text = readFileSync(join(FIXTURES, 'ledgers', fixture), 'utf-8').replace('__TRANSCRIPT__', transcriptPath ?? '/nonexistent');
  writeFileSync(join(flowlensDir, 'agent-ledger', fixture), text);
}

export function line(o: unknown): string {
  return `${JSON.stringify(o)}\n`;
}

export interface FakeSession {
  id: string;
  flowlens: number;
  reads: number;
  /** Write the event log too (default false). */
  ledger?: boolean;
  ts?: string;
}

/** Transcript text with `reads` Read calls and `flowlens` mcp__flowlens__ calls, one call per assistant message. */
export function fakeTranscript(s: FakeSession): string {
  const ts = s.ts ?? new Date().toISOString();
  let out = line({ type: 'user', timestamp: ts, message: { role: 'user', content: 'do the task' } });
  let n = 0;
  const call = (name: string): void => {
    out += line({
      type: 'assistant', timestamp: ts,
      message: {
        id: `${s.id}-m${n}`, role: 'assistant',
        content: [{ type: 'tool_use', id: `${s.id}-t${n++}`, name, input: {} }],
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 },
      },
    });
  };
  for (let i = 0; i < s.flowlens; i++) call('mcp__flowlens__impact');
  for (let i = 0; i < s.reads; i++) call('Read');
  return out;
}

export function writeFakeSession(p: ReturnType<typeof makeProject>, s: FakeSession, projectDirName: string): string {
  const dir = join(p.projectsRoot, projectDirName);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${s.id}.jsonl`);
  writeFileSync(path, fakeTranscript(s));
  if (s.ledger) {
    writeFileSync(join(p.flowlensDir, 'agent-ledger', `${s.id}.jsonl`), line({
      t: 'session', provider: 'claude-code', ts: s.ts ?? new Date().toISOString(), session_id: s.id, transcript_path: path,
    }));
  }
  return path;
}
