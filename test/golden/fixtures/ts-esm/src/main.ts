import { Service } from './services/service.js';

export function main(): void {
  const s = new Service();
  s.run();
}

export function configure(name: string, retries: number): string {
  return name + retries;
}

export function start(name: string): Service {
  return new Service();
}
