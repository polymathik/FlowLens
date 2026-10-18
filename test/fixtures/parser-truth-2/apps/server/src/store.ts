import { EventEmitter } from 'node:events';

export class BaseStore {
  ping(): void {}
}

export class Store extends BaseStore {
  touch(): void {}
}

export class Bus extends EventEmitter {
  fire(): void {}
}

export const store = new Store();
export const bus = new Bus();
