import { invoiceTotal } from './billing';
import { query } from '../data/db';
import { slugify } from '../utils/helpers';

export interface Order { id: string; total: number }

export function listOrders(userId: string): Order[] {
  return query(`orders:${slugify(userId)}`).map((id) => ({ id, total: 0 }));
}

export function orderTotal(id: string): number {
  return invoiceTotal(id);
}
