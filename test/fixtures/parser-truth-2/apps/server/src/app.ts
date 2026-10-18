import { Hono } from 'hono';
import { parseId } from '@pt/core';
import { boot, onShutdown } from './boot.js';

function health(): string {
  return 'ok';
}

function audit(id: string): void {
  void id;
}

function sessionList(c: { text(s: string): string }): string {
  return c.text('list');
}

const app = new Hono();

app.get('/health', (c) => c.text(health()));
app.get('/sessions/:id', (c) => {
  const id = parseId(c.req.param('id'));
  audit(id ?? '');
  audit('again');
  return c.text(String(id));
});

app.get('/sessions', sessionList);
process.on('SIGTERM', onShutdown);
boot(app);

export function listRoutes(items: string[]): number {
  return items.filter((i) => i.length > health().length).length;
}

export default app;
