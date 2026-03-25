import { createHash } from 'node:crypto';

export function generateEntityId(filePath: string, name: string, kind: string): string {
  const raw = `${filePath}:${name}:${kind}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export function generateRelationId(
  fromId: string,
  toId: string,
  type: string,
  file: string,
  line: number
): string {
  const raw = `${fromId}:${toId}:${type}:${file}:${line}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}
