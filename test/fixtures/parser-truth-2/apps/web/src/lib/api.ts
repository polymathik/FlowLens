function fetchJson(path: string): Promise<unknown> {
  return fetch(path).then((r) => r.json());
}

export const api = {
  workspace: () => fetchJson('/api/workspace'),
  async save(id: string) {
    return fetchJson(`/api/${id}`);
  },
  version: 3,
  get label() {
    return 'api';
  },
};
