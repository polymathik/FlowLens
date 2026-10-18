import { query } from '../db/client.js';

export async function seedAll(file: string) {
  return query(`seed ${file}`);
}
