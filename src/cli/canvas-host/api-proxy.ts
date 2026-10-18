/**
 * Minimal streaming reverse proxy for `/flowlens-api/*`.
 *
 * Why a proxy: `startGraphServer()` (owned by the canvas lane) creates and
 * listens its own Express app and exposes no way to add middleware. Until
 * it offers a composable `createGraphApp()`, the canvas host starts it on
 * an internal loopback port and forwards API calls to it, so the user
 * still sees ONE origin/port serving both the SPA and the API.
 *
 * Streams request and response bodies (no buffering), so the SSE endpoint
 * `/flowlens-api/events` works: when the browser disconnects, the upstream
 * request is destroyed so the graph server drops the client.
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
export function createApiProxy(targetPort: number): RequestHandler {
  return (req, res) => {
    const upstream = http.request(
      {
        host: LOOPBACK,
        port: targetPort,
        method: req.method,
        path: req.originalUrl,
        headers: { ...forwardableHeaders(req.headers), host: `${LOOPBACK}:${targetPort}` },
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
