import { truncate } from '../utils/helpers';

export function notifyUser(id: string): string {
  return truncate(id, 8);
}
