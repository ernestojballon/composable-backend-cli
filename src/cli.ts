#!/usr/bin/env node
import { Command } from 'commander';
import { createApp } from './commands/create-app.js';
import { newFlow } from './commands/new-flow.js';
import { newTask } from './commands/new-task.js';

const program = new Command();

program
  .name('compoback')
  .description('CLI for composable-backend')
  .version('1.0.0');

const createCmd = program.command('create');
createCmd
  .command('app [name]')
  .description('Scaffold a new composable-backend project')
  .action(createApp);

const newCmd = program.command('new');
newCmd
  .command('flow <name> [path]')
  .description('Generate a new flow definition (*.flow.yml)')
  .action(newFlow);
newCmd
  .command('task <name> [path]')
  .description('Generate a new task (*.task.ts)')
  .action(newTask);

program.parse();
