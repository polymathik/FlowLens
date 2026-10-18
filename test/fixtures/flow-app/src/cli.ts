#!/usr/bin/env node
import { Command } from 'commander';
import { start } from './server.js';
import { seedAll } from './services/seed.js';
import { migrateUp } from './services/migrate.js';

const program = new Command();

function runServe(opts: { port: string }) {
  start(Number(opts.port));
}

program.command('serve').description('Start the server').option('-p, --port <n>', 'port').action(runServe);
program.command('seed <file>').description('Seed data').action(async (file: string) => {
  await seedAll(file);
});

const db = new Command('db');
const migrate = new Command('migrate').description('Run migrations').action(() => {
  migrateUp();
});
db.addCommand(migrate);
program.addCommand(db);

program.parse();
