import { slugify } from '../utils/helpers';

export function userKey(name: string): string {
  return slugify(name);
}
