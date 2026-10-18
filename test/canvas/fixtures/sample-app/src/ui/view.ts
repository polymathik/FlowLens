import type { User } from '../core/model';
import { badge } from './widgets';

export function renderUser(user: User): string {
  return `<p>${user.name} ${badge(user.name)}</p>`;
}

export function viewTitle(): string {
  return 'Users';
}
