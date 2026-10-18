import { truncate } from '../utils/helpers';

export function stockLevel(id: string): string {
  return truncate(id, 8);
}
