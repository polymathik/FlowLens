import type { Runnable } from '@lib/base';

export class User implements Runnable {
  run(): void {}
  name(): string {
    return 'u';
  }
}
