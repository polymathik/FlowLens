import { handleGetUser } from './routes';
import { UserStore } from '../core/store';

export function main(): string {
  const store = new UserStore();
  store.add('Ada Lovelace');
  return handleGetUser(store, 'ada');
}
