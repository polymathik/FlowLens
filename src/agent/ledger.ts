/**
 * The agent usage event log: `.flowlens/agent-ledger/<session_id>.jsonl`, one JSON event per line
 * (types in contracts/agent-setup.ts). Written by the hooks (gate, recorder, context, guard), read by
 * the gate (which files were queried this session) and by `flowlens agent stats`.
 *
 * Appends are single `appendFile` calls of one short line, safe under parallel tool calls; readers
 * skip lines that do not parse. Every function swallows IO errors where noted: logging must never
 * break a hook.
 */
import { appendFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AGENT_LEDGER_DIR,
  AGENT_LEDGER_RETENTION_DAYS,
  type AgentLogEvent,
} from '../contracts/agent-setup.js';

export function ledgerDir(flowlensDir: string): string {
  return join(flowlensDir, AGENT_LEDGER_DIR);
}

/** Session ids come from the agent; keep only filename-safe characters. */
export function safeSessionId(sessionId: string | undefined): string | null {
  if (!sessionId) return null;
  const clean = sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return clean && !/^\.+$/.test(clean) ? clean : null;
}

export function ledgerPath(flowlensDir: string, sessionId: string): string | null {
  const id = safeSessionId(sessionId);
  return id ? join(ledgerDir(flowlensDir), `${id}.jsonl`) : null;
}

/** Append one event. Returns false (never throws) when it could not be written. */
export async function appendLogEvent(flowlensDir: string, event: AgentLogEvent): Promise<boolean> {
  const path = ledgerPath(flowlensDir, event.session_id);
  if (!path) return false;
  try {
    await mkdir(ledgerDir(flowlensDir), { recursive: true });
    await appendFile(path, `${JSON.stringify(event)}\n`, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** Events of one session, oldest first; unparseable lines are skipped. */
export async function readSessionLog(flowlensDir: string, sessionId: string): Promise<AgentLogEvent[]> {
  const path = ledgerPath(flowlensDir, sessionId);
  if (!path) return [];
  return parseLog(await readFile(path, 'utf-8').catch(() => ''));
}

export function parseLog(text: string): AgentLogEvent[] {
  const events: AgentLogEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as AgentLogEvent;
      if (value && typeof value === 'object' && typeof value.t === 'string' && typeof value.session_id === 'string') events.push(value);
    } catch {
      // torn or foreign line: ignore
    }
  }
  return events;
}

/** Session ids that have a ledger, newest activity first. */
export async function listLedgerSessions(flowlensDir: string): Promise<Array<{ session_id: string; mtime_ms: number }>> {
  const dir = ledgerDir(flowlensDir);
  const names = await readdir(dir).catch(() => [] as string[]);
  const rows: Array<{ session_id: string; mtime_ms: number }> = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const s = await stat(join(dir, name)).catch(() => null);
    if (s) rows.push({ session_id: name.slice(0, -'.jsonl'.length), mtime_ms: s.mtimeMs });
  }
  return rows.sort((a, b) => b.mtime_ms - a.mtime_ms);
}

/** Delete ledgers not touched for `AGENT_LEDGER_RETENTION_DAYS`; returns how many were removed. */
export async function pruneLedgers(flowlensDir: string, now = Date.now()): Promise<number> {
  const cutoff = now - AGENT_LEDGER_RETENTION_DAYS * 86_400_000;
  let removed = 0;
  for (const row of await listLedgerSessions(flowlensDir)) {
    if (row.mtime_ms >= cutoff) continue;
    const path = ledgerPath(flowlensDir, row.session_id);
    if (path && (await rm(path, { force: true }).then(() => true, () => false))) removed++;
  }
  return removed;
}
