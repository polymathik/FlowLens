/**
 * History without the event log: Claude Code keeps every session's transcript under
 * `~/.claude/projects/<project path with every non-alphanumeric character replaced by '-'>/`
 * (verified: `/home/claude` is `-home-claude`). `CLAUDE_CONFIG_DIR` relocates `~/.claude`.
 */
import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentSessionStats } from '../../contracts/agent-setup.js';
import { listLedgerSessions, readSessionLog } from '../ledger.js';
import type { ClassifiedSession } from './compare.js';
import { statsFromEvents, withTranscript } from './session-stats.js';
import { readClaudeTranscript } from './transcript-claude.js';

/** Claude Code shortens longer directory names (a hash is appended); only the prefix is relied on then. */
const LONG_NAME = 200;

export function claudeProjectsRoot(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const base = env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.trim() !== '' ? env.CLAUDE_CONFIG_DIR : join(home, '.claude');
  return join(base, 'projects');
}

export function claudeProjectDirName(projectPath: string): string {
  return projectPath.replace(/[^A-Za-z0-9]/g, '-');
}

/** Existing transcript directories for a project (the path as given and its symlink-resolved form). */
export async function findClaudeProjectDirs(projectRoot: string, projectsRoot = claudeProjectsRoot()): Promise<string[]> {
  const names = await readdir(projectsRoot).catch(() => [] as string[]);
  if (names.length === 0) return [];
  const real = await realpath(projectRoot).catch(() => projectRoot);
  const wanted = new Set([claudeProjectDirName(projectRoot), claudeProjectDirName(real)]);
  const found = new Set<string>();
  for (const want of wanted) {
    if (names.includes(want)) found.add(want);
    else if (want.length > LONG_NAME) {
      for (const n of names) if (n.startsWith(want.slice(0, LONG_NAME))) found.add(n);
    }
  }
  return [...found].map((n) => join(projectsRoot, n));
}

export interface HistoryOptions {
  projectRoot: string;
  flowlensDir: string;
  sinceMs?: number | null;
  limit: number;
  projectsRoot?: string;
}

export interface HistoryResult {
  dirs: string[];
  sessions: ClassifiedSession[];
  /** Transcript files found before `since`/`limit` were applied. */
  files_found: number;
}

interface TranscriptFile { id: string; path: string; mtime_ms: number }

async function listTranscripts(dirs: readonly string[]): Promise<TranscriptFile[]> {
  const files: TranscriptFile[] = [];
  for (const dir of dirs) {
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!name.endsWith('.jsonl')) continue;
      const path = join(dir, name);
      const s = await stat(path).catch(() => null);
      if (s?.isFile()) files.push({ id: name.slice(0, -'.jsonl'.length), path, mtime_ms: s.mtimeMs });
    }
  }
  return files.sort((a, b) => b.mtime_ms - a.mtime_ms);
}

/** Look up one Claude Code session by id (or unique id prefix) among the project's transcripts. */
export async function findClaudeTranscript(
  projectRoot: string,
  sessionId: string,
  projectsRoot?: string,
): Promise<TranscriptFile | null> {
  const files = await listTranscripts(await findClaudeProjectDirs(projectRoot, projectsRoot));
  const exact = files.find((f) => f.id === sessionId);
  if (exact) return exact;
  const prefixed = files.filter((f) => f.id.startsWith(sessionId));
  return prefixed.length === 1 ? prefixed[0]! : null;
}

/** A session built from its transcript, with the event log merged in when one exists. */
export async function sessionFromTranscript(
  file: TranscriptFile,
  flowlensDir: string,
  hasLedger: boolean,
): Promise<ClassifiedSession | null> {
  const summary = await readClaudeTranscript(file.path);
  if (!summary) return null;
  const events = hasLedger ? await readSessionLog(flowlensDir, file.id) : [];
  const base: AgentSessionStats = statsFromEvents(file.id, events);
  if (base.provider === 'unknown') base.provider = 'claude-code';
  const stats = withTranscript(base, file.path, summary);
  if (!stats.started) stats.started = new Date(file.mtime_ms).toISOString();
  return { stats, with_flowlens: summary.flowlens_calls > 0 || hasLedger };
}

export async function scanClaudeHistory(opts: HistoryOptions): Promise<HistoryResult> {
  const dirs = await findClaudeProjectDirs(opts.projectRoot, opts.projectsRoot);
  const files = await listTranscripts(dirs);
  const ledgerIds = new Set((await listLedgerSessions(opts.flowlensDir)).map((r) => r.session_id));
  const inRange = files.filter((f) => opts.sinceMs == null || f.mtime_ms >= opts.sinceMs);
  const sessions: ClassifiedSession[] = [];
  for (const file of inRange) {
    if (sessions.length >= opts.limit) break;
    const session = await sessionFromTranscript(file, opts.flowlensDir, ledgerIds.has(file.id));
    if (!session) continue;
    const started = Date.parse(session.stats.started);
    if (opts.sinceMs != null && Number.isFinite(started) && started < opts.sinceMs) continue;
    sessions.push(session);
  }
  return { dirs, sessions, files_found: files.length };
}
