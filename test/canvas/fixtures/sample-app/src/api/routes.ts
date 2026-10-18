import { UserStore } from '../core/store';
import { renderUser } from '../ui/view';

export function handleGetUser(store: UserStore, query: string): string {
  const user = store.find(query);
  return user ? renderUser(user) : 'not found';
}
