import { query } from '../db/client.js';

export function ping(n: number): number {
  query('ping');
  return n > 0 ? pong(n - 1) : 0;
}

export function pong(n: number): number {
  return ping(n);
}
