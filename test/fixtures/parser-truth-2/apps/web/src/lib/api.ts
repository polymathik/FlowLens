function fetchJson(path: string): Promise<unknown> {
  return fetch(path).then((r) => r.json());
}

export const api = {
  workspace: () => fetchJson('/api/workspace'),
};
