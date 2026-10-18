import { query } from './db/client.js';

function shutdown() {
  query('bye');
}

process.on('SIGTERM', shutdown);
