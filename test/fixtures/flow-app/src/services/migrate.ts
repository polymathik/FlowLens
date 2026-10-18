import { query } from '../db/client.js';

export function migrateUp() {
  return query('migrate');
}
