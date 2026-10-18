import { clamp } from '../utils/helpers';

export interface Item { sku: string; qty: number; price: number; tags: string[] }

export function computePrice(items: Item[], coupon: string | null, member: boolean): number {
  let total = 0;
  for (const item of items) {
    if (item.qty > 0) {
      if (item.tags.includes('sale')) {
        if (member) {
          total += item.price * item.qty * 0.8;
        } else if (coupon && coupon.startsWith('SALE')) {
          total += item.price * item.qty * 0.85;
        } else {
          total += item.price * item.qty * 0.9;
        }
      } else {
        for (const tag of item.tags) {
          if (tag === 'bulk' && item.qty > 10) {
            total -= item.qty > 100 ? 50 : 10;
          } else if (tag === 'fragile') {
            total += member ? 2 : 5;
          }
        }
        total += item.price * item.qty;
      }
    } else if (item.qty < 0) {
      if (member && coupon) {
        total -= item.price;
      } else {
        throw new Error('bad quantity');
      }
    }
  }
  if (coupon) {
    if (coupon === 'FREE' && member) {
      return 0;
    } else if (coupon.length > 4 && total > 100) {
      total = total * 0.95;
    }
  }
  return clamp(total, 0, 1_000_000);
}
