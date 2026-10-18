import { truncate } from '../utils/helpers';

export function shippingCost(id: string): string {
  return truncate(id, 8);
}
