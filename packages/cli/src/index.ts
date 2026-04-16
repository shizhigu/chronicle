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
import { registerDoctorCommand } from './commands/doctor.js';
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
registerDoctorCommand(program);

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
  console.error(`\nERROR: ${summariseError(err)}`);
  if (process.env.CHRONICLE_VERBOSE === '1' && err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  console.log(`\nNEXT_STEPS
- show_user "Something went wrong. Try 'chronicle doctor' to diagnose, or rerun with CHRONICLE_VERBOSE=1 for the stack."
END_NEXT_STEPS`);
  process.exit(1);
});

/**
 * Human-readable one-liner for an error. Especially: turn a raw ZodError's
 * multi-issue JSON dump into a prose summary so the user sees
 * "Compiler output had 2 schema violations (rules[0].scope expected object,
 * got string; ...)" instead of a 30-line structured log.
 */
function summariseError(err: unknown): string {
  if (!err) return 'Unknown error';
  // ZodError duck-type — avoids importing zod into the entry point.
  const maybeZod = err as { name?: string; issues?: Array<{ path?: unknown[]; message?: string }> };
  if (maybeZod.name === 'ZodError' && Array.isArray(maybeZod.issues)) {
    const issues = maybeZod.issues.slice(0, 3);
    const parts = issues.map((i) => {
      const path = Array.isArray(i.path) && i.path.length > 0 ? i.path.join('.') : '<root>';
      return `${path}: ${i.message ?? 'invalid'}`;
    });
    const more =
      maybeZod.issues.length > issues.length
        ? ` (+${maybeZod.issues.length - issues.length} more)`
        : '';
    return `Schema validation failed — ${parts.join('; ')}${more}. This usually means the model returned a shape the compiler couldn't parse; retrying often helps on small models.`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
