import { query } from '../db/client.js';

export function listOrders() {
  return query('select * from orders');
}
