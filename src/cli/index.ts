#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { indexCommand } from './commands/index-cmd.js';
import { checkCommand } from './commands/check.js';
import { serveCommand } from './commands/serve.js';
import { canvasCommand } from './commands/canvas.js';
import { doctorCommand } from './commands/doctor.js';
import { exportCommand } from './commands/export.js';
import { watchCommand } from './commands/watch.js';
import { snapshotCommand } from './commands/snapshot.js';
import { reportCommand } from './commands/report.js';
import { daemonCommand } from './commands/daemon.js';
import { projectsCommand } from './commands/projects.js';
import { agentCommand } from './commands/agent.js';

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
program.addCommand(doctorCommand);
program.addCommand(exportCommand);
program.addCommand(watchCommand);
program.addCommand(snapshotCommand);
program.addCommand(reportCommand);
program.addCommand(daemonCommand);
program.addCommand(projectsCommand);
program.addCommand(agentCommand);

program.parse();
