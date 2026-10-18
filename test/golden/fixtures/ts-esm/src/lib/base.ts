export abstract class Base {
  run(): void {}
  describe(): string {
    return 'base';
  }
}

export interface Runnable {
  run(): void;
}

export class AppError extends Error {}
