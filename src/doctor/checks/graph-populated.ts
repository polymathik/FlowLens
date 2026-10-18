import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DiagnosticRunner } from '../../contracts/doctor.js';
import { isGraphLockedError } from '../../agent/graph-access.js';
import { graphErrorMessage, lockedMessage, openDoctorGraph } from './open-graph.js';

export const graphPopulatedCheck: DiagnosticRunner = async (ctx) => {
  const base = {
    name: 'graph-populated',
    title: 'Graph populated',
  };

  if (!existsSync(join(ctx.flowlensDir, 'graph'))) {
    return {
      ...base,
      status: 'error',
      message: 'graph directory missing',
      details: 'Run "flowlens index" to build the graph.',
    };
  }

  const opened = await openDoctorGraph(ctx);
  if (!opened.ok) {
    return { ...base, status: 'error', message: opened.locked ? lockedMessage(ctx) : `graph open failed: ${opened.message}` };
  }
  const store = opened.graph;
  try {
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
      message: isGraphLockedError(err) ? lockedMessage(ctx) : `graph read failed: ${graphErrorMessage(err)}`,
    };
  } finally {
    await store.close().catch(() => undefined);
  }
};
