/**
 * End-to-end CLI tests (spawned processes) for Phase 10 fixes:
 *  - `flowlens export` piped stdout is complete (was cut at 64–128 KB)
 *  - `flowlens doctor --format json` lists MCP tools and reports AI as skipped
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { LevelGraphStore } from '../../src/graph/levelgraph-store.js';
import type { Entity } from '../../src/contracts/entities.js';
import type { Relation } from '../../src/contracts/relations.js';

const CLI = resolve(import.meta.dirname, '../../src/cli/index.ts');
// `--import tsx` resolves from the child's cwd (a temp dir), so pass an absolute URL.
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

function runCli(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['--import', TSX, CLI, ...args], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    child.on('close', (code) =>
      done({ code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() }),
    );
  });
}

function bigGraph(n: number): { entities: Entity[]; relations: Relation[] } {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  for (let i = 0; i < n; i++) {
    entities.push({
      id: `src/mod${i % 50}/file${i}.ts:fn${i}`,
      kind: 'function',
      name: `someLongishFunctionName_${i}`,
      qualified_name: `src/mod${i % 50}/file${i}.ts/someLongishFunctionName_${i}`,
      file: `src/mod${i % 50}/file${i}.ts`,
      location: { line_start: 1, line_end: 20, column_start: 0, column_end: 1 },
      visibility: 'public',
      language: 'typescript',
    });
    if (i > 0) {
      relations.push({
        id: `r${i}`,
        from: entities[i - 1].id,
        to: entities[i].id,
        type: 'call',
        location: { file: entities[i - 1].file, line: 2, column: 0 },
        weight: 1,
        confidence: 1,
      });
    }
  }
  return { entities, relations };
}

describe('CLI export/doctor (spawned)', () => {
  let tmp: string;
  const N = 3000;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'flowlens-cli-e2e-'));
    const fl = join(tmp, '.flowlens');
    await mkdir(fl, { recursive: true });
    await writeFile(
      join(fl, 'config.json'),
      JSON.stringify({
        exclude: [],
        languages: { typescript: true },
        ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
      }),
    );
    const store = new LevelGraphStore();
    await store.open(join(fl, 'graph'));
    const g = bigGraph(N);
    await store.putNodes(g.entities);
    await store.putEdges(g.relations);
    await store.close();
  }, 60_000);

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('export --format json writes the complete document to a pipe', async () => {
    const r = await runCli(['export', '--format', 'json'], tmp);
    expect(r.code).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(512 * 1024); // well past the old 64–128 KB cut
    const parsed = JSON.parse(r.stdout) as { entities: unknown[]; relations: unknown[] };
    expect(parsed.entities).toHaveLength(N);
    expect(parsed.relations).toHaveLength(N - 1);
  }, 60_000);

  it('export --format mermaid warns on stderr about renderer size limits', async () => {
    const r = await runCli(['export', '--format', 'mermaid'], tmp);
    expect(r.code).toBe(0);
    expect(r.stdout.startsWith('graph LR')).toBe(true);
    expect(r.stderr).toMatch(/larger than the default renderer allows/);
    expect(r.stderr).toMatch(/--scope "src\/mod/);
  }, 60_000);

  it('doctor builds the MCP server in-process and reports AI as skipped', async () => {
    const r = await runCli(['doctor', '--format', 'json'], tmp);
    const report = JSON.parse(r.stdout) as {
      checks: Array<{ name: string; status: string; message: string }>;
    };
    const mcp = report.checks.find((c) => c.name === 'mcp-reachable');
    expect(mcp?.status).toBe('ok');
    expect(mcp?.message).toMatch(/12 tools listed/);
    const ai = report.checks.find((c) => c.name === 'ai-configured');
    expect(ai?.status).toBe('skipped');
    expect(ai?.message).toMatch(/disabled/);
  }, 60_000);
});
