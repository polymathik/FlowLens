export function validateUser(body: unknown) {
  if (!body) throw new Error('empty');
  return true;
}
