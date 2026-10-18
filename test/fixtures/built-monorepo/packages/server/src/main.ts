import { LiveService } from './live/service.js';

export function main(): string {
  const service = new LiveService();
  return service.describe(service.start('hello'));
}
