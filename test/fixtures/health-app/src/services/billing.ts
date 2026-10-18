import { listOrders } from './orders';
import { roundTo } from '../utils/helpers';

export function invoiceTotal(orderId: string): number {
  return roundTo(orderId.length * 1.5, 2);
}

export function billUser(userId: string): number {
  return listOrders(userId).reduce((sum, o) => sum + invoiceTotal(o.id), 0);
}
