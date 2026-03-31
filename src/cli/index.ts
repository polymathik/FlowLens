#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { indexCommand } from './commands/index-cmd.js';
import { checkCommand } from './commands/check.js';
import { serveCommand } from './commands/serve.js';
import { canvasCommand } from './commands/canvas.js';

const program = new Command();

program
  .name('flowlens')
  .description('Local-first code intelligence platform')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(indexCommand);
program.addCommand(checkCommand);
program.addCommand(serveCommand);
program.addCommand(canvasCommand);

program.parse();
