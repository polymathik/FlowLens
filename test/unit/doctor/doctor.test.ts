import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultDoctor, runDoctor as runDoctorDefault } from '../../../src/doctor/doctor.js';

// Unit scope: open graphs directly (daemon paths are covered by integration tests).
const runDoctor = (root: string) => runDoctorDefault(root, { daemon: false });
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import type { Entity } from '../../../src/contracts/entities.js';

function entity(id: string, name: string): Entity {
  return {
    id,
    kind: 'class',
    name,
    qualified_name: `test/${name}`,
    file: 'test.ts',
    location: { line_start: 1, line_end: 2, column_start: 0, column_end: 0 },
    visibility: 'public',
    language: 'typescript',
  };
}

async function makeFlowlensDir(root: string): Promise<string> {
  const fl = join(root, '.flowlens');
  await mkdir(fl, { recursive: true });
  await writeFile(
    join(fl, 'config.json'),
    JSON.stringify({ exclude: [], languages: { typescript: true } }),
  );
  const store = new LevelGraphStore();
  await store.open(join(fl, 'graph'));
  await store.putNodes([entity('e1', 'Foo')]);
  await store.close();
  return fl;
}

describe('runDoctor', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'flowlens-doctor-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('reports an error when .flowlens/ is missing', async () => {
    const report = await runDoctor(tmp);
    expect(report.overall).toBe('error');

    const flowlensCheck = report.checks.find((c) => c.name === 'flowlens-dir-exists');
    expect(flowlensCheck?.status).toBe('error');
    expect(flowlensCheck?.message).toContain('not found');
  });

  it('reports ok for a healthy minimal project', async () => {
    await makeFlowlensDir(tmp);

    const report = await runDoctor(tmp);

    const flowlensCheck = report.checks.find((c) => c.name === 'flowlens-dir-exists');
    expect(flowlensCheck?.status).toBe('ok');

    const graphCheck = report.checks.find((c) => c.name === 'graph-populated');
    expect(graphCheck?.status).toBe('ok');
    expect(graphCheck?.message).toContain('1 entities');

    const configCheck = report.checks.find((c) => c.name === 'config-valid');
    expect(configCheck?.status).toBe('ok');

    // architecture.json missing → warning (not error), so overall may be warning
    expect(['ok', 'warning']).toContain(report.overall);
  });

  it('warns when architecture.json has wrong version', async () => {
    const fl = await makeFlowlensDir(tmp);
    await writeFile(join(fl, 'architecture.json'), JSON.stringify({ version: 1, layers: [] }));

    const report = await runDoctor(tmp);
    const archCheck = report.checks.find((c) => c.name === 'architecture-valid');
    expect(archCheck?.status).toBe('warning');
    expect(archCheck?.message).toContain('v2');
  });

  it('oks a valid v2 architecture.json', async () => {
    const fl = await makeFlowlensDir(tmp);
    await writeFile(
      join(fl, 'architecture.json'),
      JSON.stringify({
        version: 2, inferred_by: 'manual', inferred_at: '2026-10-18T00:00:00Z',
        layers: [{ name: 'Core', include: { patterns: ['src/core/**'] } }, { name: 'UI', include: { patterns: ['src/ui/**'] }, may_only_access: ['Core'] }],
      }),
    );

    const report = await runDoctor(tmp);
    const archCheck = report.checks.find((c) => c.name === 'architecture-valid');
    expect(archCheck?.status).toBe('ok');
    expect(archCheck?.message).toContain('2 layers');
  });

  // Doctor now uses the same loader as check/MCP/agents (loadArchConfig): a file
  // those commands reject must not be reported valid. (The old test accepted
  // layers without `include`, which every consumer then ignored.)
  it('warns when a v2 architecture.json fails the schema or references an unknown layer', async () => {
    const fl = await makeFlowlensDir(tmp);
    await writeFile(join(fl, 'architecture.json'), JSON.stringify({ version: 2, layers: [{ name: 'Core' }] }));
    let check = (await runDoctor(tmp)).checks.find((c) => c.name === 'architecture-valid');
    expect(check?.status).toBe('warning');
    expect(check?.message).toContain('does not match the v2 schema');

    await writeFile(join(fl, 'architecture.json'), JSON.stringify({
      version: 2, inferred_by: 'manual', inferred_at: 'x',
      layers: [{ name: 'Core', include: { patterns: ['src/**'] }, must_not_access: ['Ghost'] }],
    }));
    check = (await runDoctor(tmp)).checks.find((c) => c.name === 'architecture-valid');
    expect(check?.status).toBe('warning');
    expect(check?.message).toContain("unknown layer 'Ghost'");
  });

  it('errors when architecture.json is not JSON', async () => {
    const fl = await makeFlowlensDir(tmp);
    await writeFile(join(fl, 'architecture.json'), '{ nope');
    const check = (await runDoctor(tmp)).checks.find((c) => c.name === 'architecture-valid');
    expect(check?.status).toBe('error');
  });

  it('errors when config.json is malformed', async () => {
    const fl = await makeFlowlensDir(tmp);
    await writeFile(join(fl, 'config.json'), '{ not json');

    const report = await runDoctor(tmp);
    const configCheck = report.checks.find((c) => c.name === 'config-valid');
    expect(configCheck?.status).toBe('error');
    expect(report.overall).toBe('error');
  });

  it('errors when graph is empty', async () => {
    const fl = join(tmp, '.flowlens');
    await mkdir(fl, { recursive: true });
    await writeFile(join(fl, 'config.json'), JSON.stringify({ root_dir: tmp }));
    const store = new LevelGraphStore();
    await store.open(join(fl, 'graph'));
    await store.close();

    const report = await runDoctor(tmp);
    const graphCheck = report.checks.find((c) => c.name === 'graph-populated');
    expect(graphCheck?.status).toBe('error');
    expect(graphCheck?.message).toContain('no entities');
  });

  it('produces deterministic check order', async () => {
    await makeFlowlensDir(tmp);
    const r1 = await runDoctor(tmp);
    const r2 = await runDoctor(tmp);
    const names1 = r1.checks.map((c) => c.name);
    const names2 = r2.checks.map((c) => c.name);
    expect(names1).toEqual(names2);
  });

  it('overall rolls up via worst-severity rule', async () => {
    await makeFlowlensDir(tmp);
    const report = await runDoctor(tmp);
    // no errors present → overall is worst of (warning, ok)
    const hasError = report.checks.some((c) => c.status === 'error');
    const hasWarn = report.checks.some((c) => c.status === 'warning');
    expect(hasError).toBe(false);
    expect(report.overall).toBe(hasWarn ? 'warning' : 'ok');
  });

  it('constructor accepts a custom runner list', async () => {
    const doctor = new DefaultDoctor({
      checks: [async () => ({ name: 'tiny', title: 'tiny', status: 'ok', message: 'fine' })],
    });
    const report = await doctor.diagnose(tmp);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0].name).toBe('tiny');
  });
});
