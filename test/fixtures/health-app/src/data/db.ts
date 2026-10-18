import { slugify } from '../utils/helpers';

export function query(sql: string): string[] {
  return [slugify(sql)];
}
