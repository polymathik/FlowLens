// core -> api import: a layer violation and a cross-layer file/module cycle.
import { Store } from './store';
import { handle } from '../api/handler';

export function register(name: string, store: Store): void {
  for (const n of name.split(',')) {
    if (n.length > 0 && n !== 'skip') {
      store.put(n, handle(n));
    }
  }
}

export function ping(n: number): number {
  return n <= 0 ? 0 : pong(n - 1);
}

export function pong(n: number): number {
  return n <= 0 ? 1 : ping(n - 1);
}
