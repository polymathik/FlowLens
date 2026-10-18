import { query } from '../db/client.js';

export function findUsers() {
  return query('select * from users');
}

export function saveUser(user: unknown) {
  return query(`insert ${String(user)}`);
}

function warmCache() {
  return query('warm');
}

export class UserService {
  constructor() {
    warmCache();
  }
  list() {
    return findUsers();
  }
}
