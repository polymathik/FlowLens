export type SessionId = string & { readonly __brand: 'SessionId' };

export function toSessionId(raw: string): SessionId {
  return raw.trim().toLowerCase() as SessionId;
}

export function isValidId(raw: string): boolean {
  return raw.length > 0;
}
