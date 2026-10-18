import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Entity, EntityKind } from '../../../src/contracts/entities.js';
import type { Relation } from '../../../src/contracts/relations.js';
import { InMemoryGraph } from '../../../src/agent/memory-graph.js';

export const REPO_ROOT = resolve(__dirname, '../../..');
const TSX = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = join(REPO_ROOT, 'src', 'cli', 'index.ts');

/** Base command for hooks/E2E: runs the TypeScript CLI through tsx (no build needed). */
export const TSX_CLI_COMMAND = `node "${TSX}" "${CLI}"`;

/**
 * Isolated $FLOWLENS_HOME per test file, so CLI runs auto-start their own
 * FlowLens daemon instead of using (or leaving behind) the developer's.
 * Call `stopTestDaemon()` in afterAll.
 */
let testHome: string | null = null;
export function testEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  testHome ??= mkdtempSync(join(tmpdir(), 'flowlens-agent-home-'));
  return { ...process.env, FLOWLENS_HOME: testHome, ...extra };
}

export function stopTestDaemon(): void {
  if (!testHome) return;
  spawnSync(process.execPath, [TSX, CLI, 'daemon', 'stop'], { env: testEnv(), encoding: 'utf-8', timeout: 30000 });
  rmSync(testHome, { recursive: true, force: true });
  testHome = null;
}

export function runCli(args: string[], options: { cwd: string; input?: string; env?: NodeJS.ProcessEnv }) {
  const result = spawnSync(process.execPath, [TSX, CLI, ...args], {
    cwd: options.cwd,
    input: options.input ?? '',
    encoding: 'utf-8',
    env: testEnv(options.env),
    timeout: 60000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Run an installed hook command string exactly like Claude Code's shell form (`sh -c`). */
export function runHookCommand(command: string, input: object, env: NodeJS.ProcessEnv, cwd: string) {
  const result = spawnSync('sh', ['-c', command], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf-8',
    env: testEnv(env),
    timeout: 60000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
}

export function makeGraph(): InMemoryGraph {
  const entities = [
    entity('file:service', 'file', 'user-service.ts', 'src/services/user-service.ts'),
    entity('file:repo', 'file', 'user-repo.ts', 'src/data/user-repo.ts'),
    entity('svc', 'class', 'UserService', 'src/services/user-service.ts', 6),
    entity('repo', 'class', 'UserRepo', 'src/data/user-repo.ts', 4),
  ];
  const relations = [
    relation('r1', 'file:service', 'file:repo', 'src/services/user-service.ts'),
    relation('r2', 'file:repo', 'file:service', 'src/data/user-repo.ts'),
    relation('r3', 'svc', 'repo', 'src/services/user-service.ts'),
  ];
  return new InMemoryGraph(entities, relations);
}

export function entity(id: string, kind: EntityKind, name: string, file: string, hotspot = 0): Entity {
  return {
    id,
    kind,
    name,
    qualified_name: `${file}:${name}`,
    file,
    location: { line_start: 1, line_end: 5, column_start: 1, column_end: 1 },
    visibility: 'public',
    language: 'typescript',
    metrics: { line_count: 5, quality_score: 70, hotspot_score: hotspot },
  };
}

export function relation(id: string, from: string, to: string, file: string): Relation {
  return { id, from, to, type: 'import', location: { file, line: 1, column: 1 }, weight: 1, confidence: 1 };
}
