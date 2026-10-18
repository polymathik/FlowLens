import { describe, it, expect } from 'vitest';
import { detectEntryPoints } from '../../../src/flow/entry-points.js';
import { buildGraph } from '../../helpers/flow-graph.js';

const labels = (b: ReturnType<typeof buildGraph>) => detectEntryPoints(b.graph, b.source).filter((e) => e.kind === 'http_route').map((e) => e.label);

describe('http route detection', () => {
  it('finds Express routes, resolves handlers through imports and keeps middleware out of the way', () => {
    const b = buildGraph({
      'src/server.ts': { text: "import express from 'express';\nimport { list, create } from './h.js';\nconst app = express();\napp.get('/users', auth, list);\napp.post('/users', create);\n" },
      'src/h.ts': { text: 'export function list(){}\nexport function create(){}', symbols: [{ qn: 'list', line: 1 }, { qn: 'create', line: 2 }] },
    }, [{ from: 'src/server.ts', to: 'src/h.ts', type: 'import' }]);
    const eps = detectEntryPoints(b.graph, b.source).filter((e) => e.kind === 'http_route');
    expect(eps.map((e) => [e.label, e.entity_id])).toEqual([['GET /users', b.id('src/h.ts/list')], ['POST /users', b.id('src/h.ts/create')]]);
    expect(eps[0]).toMatchObject({ file: 'src/server.ts', line: 4, confidence: 0.95 });
    expect(eps[0].evidence).toContain('1 middleware');
    expect(eps[0].evidence).toContain('via import');
  });

  it('describes inline handlers by their span inside the enclosing function', () => {
    const text = "import { Hono } from 'hono';\nexport function createApp() {\n  const app = new Hono();\n  app.get('/a', (c) => {\n    return c.json(1);\n  });\n  return app;\n}\n";
    const b = buildGraph({ 'src/app.ts': { text, symbols: [{ qn: 'createApp', line: 2, end: 8 }] } });
    const [e] = detectEntryPoints(b.graph, b.source).filter((x) => x.kind === 'http_route');
    expect(e).toMatchObject({ label: 'GET /a', entity_id: b.id('src/app.ts/createApp'), span: { line_start: 4, line_end: 6 }, line: 4 });
  });

  it('falls back to the file at module scope with lower confidence', () => {
    const b = buildGraph({ 'src/s.ts': { text: "import express from 'express';\nconst app = express();\napp.get('/x', (req, res) => res.end());\n" } });
    const [e] = detectEntryPoints(b.graph, b.source).filter((x) => x.kind === 'http_route');
    expect(e).toMatchObject({ entity_id: b.id('src/s.ts'), confidence: 0.7, span: { line_start: 3, line_end: 3 } });
  });

  it('ignores HTTP clients, Map.get and registrations in files without a framework', () => {
    const b = buildGraph({
      'src/client.ts': { text: "import axios from 'axios';\naxios.get('/api/x', handler);\nfetchIt.get('/a', { params: 1 });\nconst m = new Map();\nm.get('key', fallback);\n", symbols: [{ qn: 'handler' }] },
      'src/plain.ts': { text: "const thing = make();\nthing.get('/x', handler);\nfunction handler(){}", symbols: [{ qn: 'handler', line: 3 }] },
    });
    expect(labels(b)).toEqual([]);
  });

  it('applies mount prefixes: same file, Router default import, basePath and Fastify register', () => {
    const b = buildGraph({
      'src/app.ts': { text: "import express from 'express';\nimport users from './routes/users.js';\nimport { Hono } from 'hono';\nconst app = express();\nconst api = express.Router();\napp.use('/v1', api);\napi.get('/ping', ping);\napi.use('/users', users);\nconst h = new Hono().basePath('/h');\nh.get('/ok', ping);\nfunction ping(){}", symbols: [{ qn: 'ping', line: 11 }, { qn: 'app', kind: 'variable', line: 4 }, { qn: 'api', kind: 'variable', line: 5 }, { qn: 'h', kind: 'variable', line: 9 }] },
      'src/routes/users.ts': { text: "import { Router } from 'express';\nconst r = Router();\nr.get('/', list);\nfunction list(){}\nexport default r;", symbols: [{ qn: 'list', line: 4 }] },
    }, [{ from: 'src/app.ts', to: 'src/routes/users.ts', type: 'import' }]);
    expect(labels(b).sort()).toEqual(['GET /h/ok', 'GET /v1/ping', 'GET /v1/users'].sort());
  });

  it('reads Fastify route objects with several methods', () => {
    const b = buildGraph({ 'src/f.ts': { text: "import Fastify from 'fastify';\nconst fastify = Fastify();\nfastify.route({ method: ['GET', 'POST'], url: '/multi', handler });\nfunction handler(){}", symbols: [{ qn: 'handler', line: 4 }] } });
    expect(labels(b).sort()).toEqual(['GET /multi', 'POST /multi']);
  });

  it('lists the route even when its handler cannot be found (low confidence, file stands in)', () => {
    const b = buildGraph({ 'src/s.ts': { text: "import express from 'express';\nconst app = express();\napp.get('/x', missingHandler);\n" } });
    const [e] = detectEntryPoints(b.graph, b.source).filter((x) => x.kind === 'http_route');
    expect(e).toMatchObject({ label: 'GET /x', entity_id: b.id('src/s.ts'), confidence: 0.4 });
    expect(e.evidence).toContain('not found in the graph');
  });

  it('is deterministic and survives unreadable files', () => {
    const b = buildGraph({ 'src/s.ts': { text: "import express from 'express';\nconst app = express();\napp.get('/b', h);\napp.get('/a', h);\nfunction h(){}", symbols: [{ qn: 'h', line: 5 }] }, 'src/gone.ts': {} });
    const once = detectEntryPoints(b.graph, b.source);
    expect(detectEntryPoints(b.graph, b.source)).toEqual(once);
    expect(detectEntryPoints(b.graph, (f) => (f === 'src/gone.ts' ? undefined : b.source(f)))).toEqual(once);
  });
});
