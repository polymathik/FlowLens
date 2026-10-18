import { findUsers, saveUser } from '../services/user-service.js';
import { auditLog } from '../services/audit.js';
import { validateUser } from '../services/validate.js';

export function listUsers(_req: unknown, res: { json(v: unknown): void }) {
  res.json(findUsers());
}

export async function createUser(body: unknown) {
  validateUser(body);
  const saved = await saveUser(body);
  auditLog('created');
  return saved;
}
