/**
 * Minimal streaming reverse proxy used by the contributor dev host
 * (`flowlens canvas --dev`): Vite serves the SPA sources on one port and
 * `/api/*` + `/auth` are forwarded to the daemon on 127.0.0.1.
 *
 * The daemon checks `Host` (loopback) and, for browser sessions, that
 * `Origin` equals `http://<Host>`; the proxy therefore rewrites Host to the
 * daemon and maps the dev origin onto the daemon origin (any other Origin
 * is passed through unchanged and refused by the daemon).
 *
 * Streams request and response bodies (no buffering), so SSE works: when
 * the browser disconnects, the upstream request is destroyed.
 */
import http from 'node:http';
import net from 'node:net';
import type { RequestHandler } from 'express';

const LOOPBACK = '127.0.0.1';

/** Ask the OS for a free TCP port on loopback. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, LOOPBACK, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** Hop-by-hop headers must not be forwarded by a proxy (RFC 9110 §7.6.1). */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
]);

function forwardableHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined && !HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

/** Express handler that forwards the request to `http://127.0.0.1:<port>`. */
export function createApiProxy(targetPort: number, o: { fromOrigin?: string } = {}): RequestHandler {
  const target = `${LOOPBACK}:${targetPort}`;
  return (req, res) => {
    const headers = { ...forwardableHeaders(req.headers), host: target };
    if (o.fromOrigin && headers.origin === o.fromOrigin) headers.origin = `http://${target}`;
    const upstream = http.request(
      {
        host: LOOPBACK,
        port: targetPort,
        method: req.method,
        path: req.originalUrl,
        headers,
      },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, forwardableHeaders(upRes.headers));
        res.flushHeaders();
        upRes.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: `graph API unavailable: ${err.message}` });
      } else {
        res.end();
      }
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  };
}
