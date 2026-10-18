import { Hono } from 'hono';
import { parseId } from '@pt/core';
import { boot } from './boot.js';

function health(): string {
  return 'ok';
}

function audit(id: string): void {
  void id;
}

const app = new Hono();

app.get('/health', (c) => c.text(health()));
app.get('/sessions/:id', (c) => {
  const id = parseId(c.req.param('id'));
  audit(id ?? '');
  audit('again');
  return c.text(String(id));
});

boot(app);

export function listRoutes(items: string[]): number {
  return items.filter((i) => i.length > health().length).length;
}

export default app;
