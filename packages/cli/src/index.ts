#!/usr/bin/env node
/**
 * chronicle — the CLI entry point.
 *
 * Commands:
 *   chronicle                          → interactive onboarding
 *   chronicle init                     → print welcome + next steps
 *   chronicle create-world --desc "..."
 *   chronicle list
 *   chronicle run <world_id> [opts]
 *   chronicle watch <world_id>
 *   chronicle intervene <world_id> --event "..."
 *   chronicle export <world_id> --out file.chronicle
 *   chronicle import file.chronicle
 *   chronicle replay <world_id>
 *   chronicle fork <world_id> --at-tick N --desc "change"
 *   chronicle review <world_id>
 *   chronicle dashboard <world_id>
 *   chronicle config
 *
 * All output includes a NEXT_STEPS block for Claude Code to parse.
 */

import { Command } from 'commander';
import { configCommand } from './commands/config.js';
import { createWorldCommand } from './commands/create-world.js';
import { dashboardCommand } from './commands/dashboard.js';
import { exportCommand } from './commands/export.js';
import { importCommand } from './commands/import.js';
import { interactiveInit } from './commands/interactive.js';
import { interveneCommand } from './commands/intervene.js';
import { listCommand } from './commands/list.js';
import { registerOnboardCommand } from './commands/onboard.js';
import { runCommand } from './commands/run.js';
import { watchCommand } from './commands/watch.js';

const program = new Command()
  .name('chronicle')
  .description('Describe a world. Watch AI agents play it out.')
  .version('0.1.0-alpha');

program
  .command('init', { isDefault: true })
  .description('Welcome + interactive onboarding')
  .action(interactiveInit);

registerOnboardCommand(program);

program
  .command('create-world')
  .description('Create a new world from a natural-language description')
  .requiredOption('--desc <text>', 'world description')
  .option('--name <name>', 'optional world name')
  // No defaults — read from ~/.chronicle/config.json if omitted. Passing these
  // CLI flags overrides the config. Any pi-agent-supported provider + any
  // model id that provider accepts are valid.
  .option('--model <id>', 'model id (overrides config.defaultModel)')
  .option('--provider <name>', 'provider id (overrides config.defaultProvider)')
  .action(createWorldCommand);

program.command('list').description('List all chronicles on this machine').action(listCommand);

program
  .command('run <worldId>')
  .description('Run a world (simulate ticks)')
  .option('--ticks <n>', 'number of ticks to run', '50')
  .option('--live', 'stream events to stdout', false)
  .option('--speed <factor>', 'simulation speed', '1x')
  .option('--budget <usd>', 'stop if budget exceeded')
  .option('--until-event <type>', 'pause when this event type fires')
  .action(runCommand);

program.command('watch <worldId>').description('Live tail a running world').action(watchCommand);

program
  .command('intervene <worldId>')
  .description('Queue a god event for next tick')
  .requiredOption('--event <text>', 'event description')
  .action(interveneCommand);

program
  .command('export <worldId>')
  .description('Export a chronicle to a .chronicle file')
  .requiredOption('--out <path>', 'output file path')
  .action(exportCommand);

program.command('import <file>').description('Import a .chronicle file').action(importCommand);

program
  .command('dashboard <worldId>')
  .description('Open live dashboard in browser')
  .option('--port <n>', 'port', '7070')
  .action(dashboardCommand);

program
  .command('config')
  .description('View or modify config')
  .option('--set <kv>', 'set config value, e.g. --set api_key=sk-ant-...')
  .action(configCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error('\nERROR:', err.message);
  console.log(`\nNEXT_STEPS
- show_user "Something went wrong. Try 'chronicle doctor' to diagnose, or rerun with --verbose."
END_NEXT_STEPS`);
  process.exit(1);
});
