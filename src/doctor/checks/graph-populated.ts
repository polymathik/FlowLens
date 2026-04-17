import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LevelGraphStore } from '../../graph/levelgraph-store.js';
import type { DiagnosticRunner } from '../../contracts/doctor.js';

export const graphPopulatedCheck: DiagnosticRunner = async ({ flowlensDir }) => {
  const base = {
    name: 'graph-populated',
    title: 'Graph populated',
  };

  const graphPath = join(flowlensDir, 'graph');
  if (!existsSync(graphPath)) {
    return {
      ...base,
      status: 'error',
      message: 'graph directory missing',
      details: 'Run "flowlens index" to build the graph.',
    };
  }

  const store = new LevelGraphStore();
  try {
    await store.open(graphPath);
    const nodes = await store.getAllNodes();
    const edges = await store.getAllEdges();
    if (nodes.length === 0) {
      return {
        ...base,
        status: 'error',
        message: 'graph has no entities',
        details: 'Indexing may have failed. Re-run "flowlens index".',
      };
    }
    return {
      ...base,
      status: 'ok',
      message: `${nodes.length.toLocaleString()} entities, ${edges.length.toLocaleString()} relations`,
    };
  } catch (err) {
    return {
      ...base,
      status: 'error',
      message: `graph open failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    try {
      await store.close();
    } catch {
      /* ignore close errors */
    }
  }
};
