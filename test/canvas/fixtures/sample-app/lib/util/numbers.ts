import { slugify } from './strings';

export function pad(n: number): string {
  return slugify(String(n)).padStart(3, '0');
}
