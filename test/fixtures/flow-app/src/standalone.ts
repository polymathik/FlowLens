import { start } from './server.js';

export function boot() {
  return start(3000);
}

if (require.main === module) {
  boot();
}
