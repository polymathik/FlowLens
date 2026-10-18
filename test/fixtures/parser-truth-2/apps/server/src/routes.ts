import type { Hono } from 'hono';
import { Discovery } from '@pt/core';
import { Actions } from './actions.js';
import { bus, store } from './store.js';

interface AppOptions {
  discovery: Discovery;
  actions?: Actions;
}

export function createRoutes(app: Hono, { discovery, actions = new Actions() }: AppOptions): void {
  app.get('/sessions/:id/command', (c) => {
    const found = discovery.session(c.req.param('id'));
    actions.resume(found);
    store.touch();
    store.ping();
    bus.custom();
    return c.json(found);
  });
}

export class Controller {
  constructor(private readonly discovery: Discovery) {}

  list() {
    return this.discovery.list();
  }

  dispatch(x: { nothing(): void }, y) {
    y.nothing();
    x.nothing();
  }
}
