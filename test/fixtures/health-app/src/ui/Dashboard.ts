import { listOrders } from '../services/orders';
import { query } from '../data/db';
import { formatMoney } from '../utils/helpers';

export function renderDashboard(userId: string): string {
  const orders = listOrders(userId);
  const raw = query('select * from orders');
  return `${orders.length} orders, ${raw.length} rows, ${formatMoney(10)}`;
}
