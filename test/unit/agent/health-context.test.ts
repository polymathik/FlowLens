/** SessionStart health headline + flowlens://health resource. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { computeGraphDigest } from '../../../src/agent/digest.js';
import { buildContextFromDigest } from '../../../src/agent/context-builder.js';
import { formatContextMarkdown } from '../../../src/agent/format.js';
import { computeHealthHeadline } from '../../../src/agent/health-headline.js';
import { createFlowLensServer } from '../../../src/mcp/server.js';
import { AnnotationStore } from '../../../src/mcp/annotation-store.js';
import { SnapshotManager } from '../../../src/analysis/snapshot-manager.js';
import { makeGraph } from './helpers.js';

describe('health in agent context and MCP', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'flowlens-health-ctx-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('computes a headline from the live graph and shows it only at SessionStart, in 3 lines', async () => {
    const graph = makeGraph();
    const health = await computeHealthHeadline(root, graph);
    expect(health).not.toBeNull();
    expect(health!.grade).toMatch(/^[A-F]$/);
    const digest = { ...(await computeGraphDigest(graph, join(root, '.flowlens'))), health };

    const session = buildContextFromDigest(digest, { event: 'session_start' }, 'cache');
    const md = formatContextMarkdown(session);
    const lines = md.split('\n');
    const at = lines.indexOf('### Health');
    expect(at).toBeGreaterThan(0);
    expect(lines.slice(at + 1, at + 4).every((l) => l.startsWith('- '))).toBe(true);
    expect(lines[at + 1]).toMatch(/^- Grade [A-F] \(\d+\/100, confidence (high|medium|low)\)/);
    expect(lines[at + 2]).toMatch(/^- Top risk: /);
    expect(lines[at + 3]).toContain('flowlens://health');
    expect(lines[at + 4]?.startsWith('- ')).toBe(false);

    const prompt = buildContextFromDigest(digest, { event: 'prompt_submit', prompt: 'user' }, 'cache');
    expect(prompt.health).toBeUndefined();
    expect(formatContextMarkdown(prompt)).not.toContain('### Health');
  });

  it('registers flowlens://health and renders the Markdown report from the server graph', async () => {
    const fl = join(root, '.flowlens');
    const server = createFlowLensServer({
      graph: makeGraph(),
      annotationStore: new AnnotationStore(join(fl, 'annotations.json')),
      snapshotManager: new SnapshotManager(join(fl, 'snapshots')),
      flowlensDir: fl,
      rootDir: root,
      fileIndexPath: join(fl, 'file_index.json'),
    });
    const client = new Client({ name: 't', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    try {
      const { resources } = await client.listResources();
      expect(resources.map((r) => r.uri)).toContain('flowlens://health');
      const read = await client.readResource({ uri: 'flowlens://health' });
      const content = read.contents[0] as { mimeType: string; text: string };
      expect(content.mimeType).toBe('text/markdown');
      expect(content.text).toMatch(/grade/i);
      expect(content.text).not.toContain('could not be built');
    } finally {
      await client.close();
    }
  });
});
