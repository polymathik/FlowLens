/**
 * End-to-end: index the realistic `health-app` fixture (with git history)
 * → load from .flowlens/ → health report → CLI output.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIndex } from '../../src/indexer/indexer.js';
import { LevelGraphStore } from '../../src/graph/levelgraph-store.js';
import { buildHealthReport, loadHealthInput } from '../../src/health/index.js';
import { runReport } from '../../src/cli/commands/report.js';
import type { FlowLensConfig } from '../../src/contracts/config.js';
import type { HealthReport } from '../../src/contracts/health.js';

const FIXTURE = join(import.meta.dirname, '../fixtures/health-app');
const REPO = join(import.meta.dirname, '../..');
const CONFIG: FlowLensConfig = {
  exclude: [],
  languages: { typescript: true, javascript: true },
  ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
};

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=FlowLens Test', '-c', 'user.email=test@example.com', ...args], { cwd, stdio: 'ignore' });
}

describe('health report end to end (health-app fixture)', () => {
  let root: string;
  let report: HealthReport;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'flowlens-health-'));
    cpSync(FIXTURE, root, { recursive: true });
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'init');
    for (let i = 0; i < 4; i++) {
      appendFileSync(join(root, 'src/services/pricing.ts'), `// tweak ${i}\n`);
      git(root, 'commit', '-qam', `tweak ${i}`);
    }
    const flowlens = join(root, '.flowlens');
    mkdirSync(flowlens);
    copyFileSync(join(root, 'architecture.json'), join(flowlens, 'architecture.json'));
    const store = new LevelGraphStore();
    await store.open(join(flowlens, 'graph'));
    await runIndex({ rootDir: root, graphStore: store, config: CONFIG, fileIndexPath: join(flowlens, 'file_index.json'), incremental: false });
    await store.close();
    report = await buildHealthReport(await loadHealthInput(root), { now: '2026-10-18T00:00:00Z' });
  }, 60_000);

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const find = (kind: string, file?: string) =>
    report.findings.filter((f) => f.kind === kind && (!file || f.focus.files.includes(file)));

  it('finds every deliberate problem', () => {
    expect(report.counts).toMatchObject({
      cycle: 1,
      god_file: 1,
      fragile_hub: 1,
      boundary_violation: 1,
      hotspot: 1,
      orphan_module: 1,
    });
    expect(find('cycle')[0].focus.files).toEqual(['src/services/billing.ts', 'src/services/orders.ts']);
    expect(find('god_file')[0].focus.files[0]).toBe('src/utils/helpers.ts');
    expect(find('fragile_hub')[0].focus.files[0]).toBe('src/utils/helpers.ts');
    expect(find('boundary_violation')[0].evidence[0]).toMatchObject({ file: 'src/ui/Dashboard.ts', line: 2 });
    expect(find('hotspot')[0].focus.files).toEqual(['src/services/pricing.ts']);
    expect(find('orphan_module')[0].evidence.map((e) => e.file)).toEqual(['src/legacy/old-report.ts']);
    const complex = find('complex_function').map((f) => f.evidence[0].name);
    expect(complex).toEqual(expect.arrayContaining(['computePrice', 'parseConfig']));
  });

  it('ranks the riskiest items first and info last', () => {
    const top3 = report.findings.slice(0, 3).map((f) => `${f.kind}:${f.focus.files[0]}`);
    expect(top3).toEqual(
      expect.arrayContaining(['fragile_hub:src/utils/helpers.ts', 'complex_function:src/services/pricing.ts']),
    );
    expect(report.findings.at(-1)!.severity).toBe('info');
    expect(report.next_steps).toHaveLength(3);
    expect(report.grade).toMatch(/[C-F]/);
  });

  it('fix prompts name the exact files and ask for a safe change', () => {
    const cycle = find('cycle')[0].fix_prompt;
    expect(cycle).toContain('src/services/billing.ts');
    expect(cycle).toContain('src/services/orders.ts');
    expect(find('complex_function', 'src/services/pricing.ts')[0].fix_prompt).toMatch(/computePrice\(\) in src\/services\/pricing\.ts/);
    expect(find('boundary_violation')[0].fix_prompt).toContain('src/data/db.ts');
    for (const f of report.findings.filter((x) => x.severity !== 'info')) {
      expect(f.fix_prompt).toMatch(/Keep the app's behaviour exactly the same/);
    }
  });

  it('measures change risk from git and reports no-manifest caveat', () => {
    expect(report.breakdown.sub_scores.find((s) => s.category === 'change_risk')!.score).toBeLessThan(100);
    expect(report.caveats.join('\n')).toMatch(/No index manifest/);
    expect(report.caveats.join('\n')).not.toMatch(/No git history/);
    expect(report.stats.files).toBe(14);
    expect(report.graph.last_indexed).toMatch(/^\d{4}-/);
  });

  it('runReport writes HTML to a file and returns exit 0', async () => {
    const res = await runReport(root, { format: 'html', out: 'health.html' });
    expect(res.exitCode).toBe(0);
    expect(readFileSync(join(root, 'health.html'), 'utf8')).toContain('Code health: ');
    expect(res.message).toMatch(/written to health\.html/);
  });

  it('runReport validates options and exits 2 without a graph', async () => {
    expect((await runReport(root, { format: 'pdf' })).exitCode).toBe(2);
    expect((await runReport(root, { top: '0' })).exitCode).toBe(2);
    const empty = mkdtempSync(join(tmpdir(), 'flowlens-empty-'));
    const res = await runReport(empty, {});
    expect(res.exitCode).toBe(2);
    expect(res.message).toMatch(/flowlens init/);
    rmSync(empty, { recursive: true, force: true });
  });

  it('CLI: piped JSON stdout is complete and exit codes are right', () => {
    const tsx = join(REPO, 'node_modules/.bin/tsx');
    const cli = join(REPO, 'src/cli/index.ts');
    expect(existsSync(tsx)).toBe(true);
    const ok = spawnSync(tsx, [cli, 'report', '--format', 'json', '--top', '50'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    expect(ok.status).toBe(0);
    const parsed = JSON.parse(ok.stdout) as HealthReport;
    expect(parsed.total_findings).toBe(report.total_findings);
    const md = spawnSync(tsx, [cli, 'report'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    expect(md.status).toBe(0);
    expect(md.stdout.trimEnd().endsWith(`Health schema v${report.schema_version}._`)).toBe(true);
    const empty = mkdtempSync(join(tmpdir(), 'flowlens-empty-'));
    const missing = spawnSync(tsx, [cli, 'report'], { cwd: empty, encoding: 'utf8', timeout: 60_000 });
    expect(missing.status).toBe(2);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toMatch(/No FlowLens map found/);
    rmSync(empty, { recursive: true, force: true });
  }, 120_000);
});
