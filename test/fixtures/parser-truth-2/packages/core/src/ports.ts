import type { EventEmitter } from 'node:events';
import type { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

export interface Clock {
  now(): number;
}

export interface Registry extends Clock {
  get(id: string): string | undefined;
  save: (id: string, value: string) => void;
  readonly size: number;
  get label(): string;
}

export interface Channel extends EventEmitter {
  open(): void;
}

export abstract class Worker {
  abstract run(job: string): void;

  start(): void {
    this.run('boot');
  }
}
