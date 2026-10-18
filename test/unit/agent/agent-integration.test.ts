import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GraphStore } from '../../../src/contracts/graph.js';
import type { Entity, EntityKind } from '../../../src/contracts/entities.js';
import type { Relation, RelationType } from '../../../src/contracts/relations.js';
import { buildAgentContext } from '../../../src/agent/context-builder.js';
import { buildAgentGuardReport } from '../../../src/agent/guard.js';
import {
  buildClaudeCodeHookSettings,
  installClaudeCodeHooks,
  uninstallClaudeCodeHooks,
} from '../../../src/agent/claude-code.js';
import { changedFilesFromHook } from '../../../src/agent/hook-input.js';
import { getGitChangedFiles } from '../../../src/agent/changed-files.js';
import { reindexAgentChangedFiles } from '../../../src/agent/reindex.js';
import { agentCommand } from '../../../src/cli/commands/agent.js';
import {
  registerAgentPrompts,
  registerAgentResources,
} from '../../../src/mcp/agent-resources.js';

describe('agent integration', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'flowlens-agent-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('builds prompt-specific context from graph entities', async () => {
    const graph = makeGraph();
    const packet = await buildAgentContext(graph, {
      event: 'prompt_submit',
      prompt: 'Update user service validation',
      max_items: 4,
    }, { flowlensDir: tmp });

    expect(packet.summary.entity_count).toBe(4);
    expect(packet.relevant_files).toContain('src/services/user-service.ts');
    expect(packet.relevant_entities[0]?.qualified_name).toContain('UserService');
    expect(packet.cycles.length).toBeGreaterThan(0);
  });

  it('reports guard risk for cycles touching changed files', async () => {
    const graph = makeGraph();
    const report = await buildAgentGuardReport(graph, {
      changed_files: ['src/services/user-service.ts'],
      max_items: 4,
    }, { flowlensDir: tmp });

    expect(report.risk).toBe('high');
    expect(report.cycles[0]?.entities).toContain('src/services/user-service.ts');
    expect(report.impacted_entities[0]?.entity.file).toBe('src/services/user-service.ts');
  });

  it('builds Claude Code hook settings with expected lifecycle events', () => {
    const settings = buildClaudeCodeHookSettings('flowlens');

    expect(settings.hooks?.SessionStart?.[0]?.matcher).toBe('startup|resume');
    expect(settings.hooks?.UserPromptSubmit?.[0]?.hooks[0]?.command)
      .toBe('flowlens agent context --hook --event prompt_submit');
    expect(settings.hooks?.PostToolUse?.[0]?.matcher).toBe('Edit|MultiEdit|Write');
    expect(settings.hooks?.PostToolUse?.[0]?.hooks[0]?.command)
      .toBe('flowlens agent guard --hook --reindex --strict');
  });

  it('installs Claude Code hooks without dropping existing settings', async () => {
    const result = await installClaudeCodeHooks({
      project_dir: tmp,
      command: 'flowlens',
    });
    const content = JSON.parse(
      await readFile(join(tmp, '.claude/settings.json'), 'utf-8'),
    );

    expect(result.hooks_added).toBe(3);
    expect(content.hooks.SessionStart[0].hooks[0].command)
      .toContain('flowlens agent context');
  });

  it('uninstalls only FlowLens Claude Code hooks', async () => {
    await installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens' });
    const result = await uninstallClaudeCodeHooks(tmp);
    const content = JSON.parse(
      await readFile(join(tmp, '.claude/settings.json'), 'utf-8'),
    );

    expect(result.hooks_removed).toBe(3);
    expect(content.hooks).toEqual({});
  });

  it('extracts changed files from Claude Code hook input', () => {
    const files = changedFilesFromHook({
      tool_input: { file_path: join(tmp, 'src/a.ts') },
      tool_response: { filePath: join(tmp, 'src/b.ts') },
    }, tmp);

    expect(files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('discovers changed files from git without noisy failures', async () => {
    execFileSync('git', ['init'], { cwd: tmp, stdio: 'ignore' });
    await mkdir(join(tmp, 'src'));
    await writeFile(join(tmp, 'src/changed.ts'), 'export const changed = true;');

    expect(getGitChangedFiles(tmp)).toEqual(['src/changed.ts']);
    expect(getGitChangedFiles(join(tmp, 'not-a-repo'))).toEqual([]);
  });

  it('incrementally re-indexes changed files for hook guards', async () => {
    await mkdir(join(tmp, 'src'));
    await writeFile(join(tmp, 'src/a.ts'), 'export function alpha() { return 1; }');
    const graph = new FakeGraph([], []);
    const result = await reindexAgentChangedFiles(tmp, graph, ['src/a.ts']);

    expect(result?.files_reparsed).toBe(1);
    expect((await graph.getAllNodes()).some((node) => node.file === 'src/a.ts')).toBe(true);
  });

  it('registers MCP agent resources and prompts', () => {
    const server = new FakeMcpServer();
    const deps = {
      graph: makeGraph(),
      annotationStore: {},
      snapshotManager: {},
      flowlensDir: tmp,
      rootDir: tmp,
      fileIndexPath: join(tmp, '.flowlens/file_index.json'),
    };

    registerAgentResources(server as never, deps as never);
    registerAgentPrompts(server as never, deps as never);

    expect(server.resources.map((item) => item.name)).toContain('flowlens-architecture');
    expect(server.resources.map((item) => item.uri)).toContain('flowlens://changed-context');
    expect(server.prompts.map((item) => item.name)).toContain('flowlens-plan-task');
    expect(server.prompts.map((item) => item.name)).toContain('flowlens-review-change');
  });

  it('registers the agent CLI command group', () => {
    const subcommands = agentCommand.commands.map((command) => command.name());

    expect(subcommands).toContain('context');
    expect(subcommands).toContain('guard');
    expect(subcommands).toContain('install');
    expect(subcommands).toContain('uninstall');
  });
});

class FakeGraph implements GraphStore {
  constructor(private entities: Entity[], private relations: Relation[]) {}

  async putNode(entity: Entity): Promise<void> {
    this.entities = this.entities.filter((item) => item.id !== entity.id).concat(entity);
  }
  async getNode(id: string): Promise<Entity | null> {
    return this.entities.find((entity) => entity.id === id) ?? null;
  }
  async getNodesByKind(kind: EntityKind): Promise<Entity[]> {
    return this.entities.filter((entity) => entity.kind === kind);
  }
  async getNodesByFile(filePath: string): Promise<Entity[]> {
    return this.entities.filter((entity) => entity.file === filePath);
  }
  async deleteNode(): Promise<void> {}
  async deleteNodesByFile(filePath: string): Promise<void> {
    this.entities = this.entities.filter((entity) => entity.file !== filePath);
  }
  async putEdge(relation: Relation): Promise<void> {
    this.relations = this.relations.filter((item) => item.id !== relation.id).concat(relation);
  }
  async getEdgesFrom(entityId: string, type?: RelationType): Promise<Relation[]> {
    return this.relations.filter((relation) =>
      relation.from === entityId && (!type || relation.type === type));
  }
  async getEdgesTo(entityId: string, type?: RelationType): Promise<Relation[]> {
    return this.relations.filter((relation) =>
      relation.to === entityId && (!type || relation.type === type));
  }
  async deleteEdge(): Promise<void> {}
  async deleteEdgesByFile(filePath: string): Promise<void> {
    this.relations = this.relations.filter((relation) => relation.location.file !== filePath);
  }
  async putNodes(entities: Entity[]): Promise<void> {
    for (const entity of entities) await this.putNode(entity);
  }
  async putEdges(relations: Relation[]): Promise<void> {
    for (const relation of relations) await this.putEdge(relation);
  }
  async getAllNodes(): Promise<Entity[]> {
    return this.entities;
  }
  async getAllEdges(): Promise<Relation[]> {
    return this.relations;
  }
  async open(): Promise<void> {}
  async close(): Promise<void> {}
  async clear(): Promise<void> {}
}

class FakeMcpServer {
  resources: Array<{ name: string; uri: string }> = [];
  prompts: Array<{ name: string }> = [];

  registerResource(name: string, uri: string): void {
    this.resources.push({ name, uri });
  }

  registerPrompt(name: string): void {
    this.prompts.push({ name });
  }
}

function makeGraph(): GraphStore {
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
  return new FakeGraph(entities, relations);
}

function entity(
  id: string,
  kind: EntityKind,
  name: string,
  file: string,
  hotspot = 0,
): Entity {
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

function relation(id: string, from: string, to: string, file: string): Relation {
  return {
    id,
    from,
    to,
    type: 'import',
    location: { file, line: 1, column: 1 },
    weight: 1,
    confidence: 1,
  };
}
