import { format } from '../shared/format';

export class Store {
  private items = new Map<string, string>();

  get(key: string): string | undefined {
    return this.items.get(format(key));
  }

  put(key: string, value: string): void {
    if (!key) {
      throw new Error('empty key');
    }
    this.items.set(format(key), value);
  }

  delete(key: string): boolean {
    return this.items.delete(key);
  }

  list(): string[] {
    return [...this.items.keys()];
  }

  clear(): void {
    this.items.clear();
  }
}

export function storeHelper(store: Store): number {
  return store.list().length;
}
