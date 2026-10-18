// Deliberately does not export `auditLog`: the import in handlers/users.ts stays unresolved.
export function writeAudit(message: string) {
  return message;
}
