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
import { addGroupCommand } from './commands/add-group.js';
import { addLocationCommand } from './commands/add-location.js';
import { addMemberCommand } from './commands/add-member.js';
import { addRuleCommand } from './commands/add-rule.js';
import { applyEffectCommand } from './commands/apply-effect.js';
import { registerAuthCommand } from './commands/auth.js';
import { configCommand } from './commands/config.js';
import { createWorldCommand } from './commands/create-world.js';
import { dashboardCommand } from './commands/dashboard.js';
import { dissolveGroupCommand } from './commands/dissolve-group.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { editCharacterCommand } from './commands/edit-character.js';
import { exportCommand } from './commands/export.js';
import { grantAuthorityCommand } from './commands/grant-authority.js';
import { importCommand } from './commands/import.js';
import { interactiveInit } from './commands/interactive.js';
import { interveneCommand } from './commands/intervene.js';
import { listAgentsCommand } from './commands/list-agents.js';
import { listGroupsCommand } from './commands/list-groups.js';
import { listLocationsCommand } from './commands/list-locations.js';
import { listRulesCommand } from './commands/list-rules.js';
import { listCommand } from './commands/list.js';
import { registerOnboardCommand } from './commands/onboard.js';
import { removeMemberCommand } from './commands/remove-member.js';
import { removeRuleCommand } from './commands/remove-rule.js';
import { runCommand } from './commands/run.js';
import { watchCommand } from './commands/watch.js';
import { summariseError } from './errors.js';
import { CliError, classifyExitCode } from './exit-codes.js';
import { hydrateEnvFromAuth } from './hydrate-env.js';

// Inject stored api-key credentials into the env BEFORE commander
// dispatches — downstream LLM calls read keys from process.env, so
// this is the bridge between `chronicle auth set` and everything else.
hydrateEnvFromAuth();

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
registerAuthCommand(program);

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
  .command('apply-effect <worldId>')
  .description('Queue a structured effect (ADR-0011). CC-facing escape hatch.')
  .option('--json <effect>', 'single Effect JSON object')
  .option('--json-array <effects>', 'JSON array of Effect objects')
  .option('--at <tick>', 'tick to apply (defaults to next)')
  .option('--description <text>', 'human-readable summary for the event log')
  .action(applyEffectCommand);

program
  .command('edit-character <worldId> <nameOrId>')
  .description('Edit an agent in a running world (persona / mood / privateState / traits)')
  .option('--persona <text>', 'replace the persona paragraph')
  .option('--mood <text>', 'new mood (empty string clears)')
  .option('--private-state <json>', 'new privateState JSON object (empty string clears)')
  .option('--traits <json>', 'replace traits (JSON object)')
  .option('--at <tick>', 'tick to apply (defaults to next)')
  .action(editCharacterCommand);

program
  .command('add-rule <worldId>')
  .description('Add a new rule to a running world (create_rule effect, applies next tick)')
  .requiredOption('--description <text>', 'natural-language description')
  .requiredOption('--tier <hard|soft|economic>', 'rule tier')
  .option('--check <predicate>', 'hard-tier predicate that must be true (required for hard)')
  .option('--predicate <expr>', 'optional predicate scoping which actions the rule considers')
  .option('--on-violation <action>', 'reject | auto_correct | penalty:energy=10 (defaults reject)')
  .option('--soft-norm <text>', 'soft-tier norm text injected into prompts')
  .option('--economic-action-type <name>', 'economic-tier: action this cost applies to')
  .option('--economic-cost-formula <formula>', 'economic-tier: e.g. "energy=2,tokens=5"')
  .option('--scope-kind <kind>', 'world | group | agent | location (default world)')
  .option('--scope-ref <id>', 'required when scope-kind != world')
  .option('--at <tick>', 'tick to apply (defaults to next)')
  .action(addRuleCommand);

program
  .command('remove-rule <worldId> <ruleId>')
  .description('Repeal an active rule (repeal_rule effect, applies next tick)')
  .option('--at <tick>', 'tick to apply (defaults to next)')
  .action(removeRuleCommand);

program
  .command('list-rules <worldId>')
  .description('Print all active rules in a world')
  .option('--json', 'emit JSON array instead of a human-readable table')
  .action(listRulesCommand);

program
  .command('list-groups <worldId>')
  .description('Print all groups in a world (members, procedure, visibility)')
  .option('--json', 'emit JSON array instead of a human-readable table')
  .option('--include-dissolved', 'include dissolved groups (default excluded)')
  .action(listGroupsCommand);

program
  .command('list-locations <worldId>')
  .description('Print all locations in a world with their adjacency graph')
  .option('--json', 'emit JSON array instead of a human-readable table')
  .action(listLocationsCommand);

program
  .command('list-agents <worldId>')
  .description('Print all agents in a world (name, location, mood, energy/health)')
  .option('--json', 'emit JSON array instead of a human-readable table')
  .option('--include-dead', 'include dead agents (default excluded)')
  .action(listAgentsCommand);

program
  .command('add-location <worldId>')
  .description('Add a new location to a running world (create_location effect, applies next tick)')
  .requiredOption('--name <text>', 'location name (unique per world, case-insensitive)')
  .requiredOption('--description <text>', 'natural-language description')
  .option('--adjacent <names>', 'comma-separated list of existing location names to connect')
  .option('--sprite-hint <hint>', 'frontend rendering hint')
  .option('--at <tick>', 'tick to apply (defaults to next)')
  .action(addLocationCommand);

program
  .command('add-group <worldId>')
  .description('Add a new group to a running world (create_group effect, applies next tick)')
  .requiredOption('--name <text>', 'group name (unique per world, case-insensitive)')
  .requiredOption('--description <text>', 'natural-language description')
  .requiredOption('--procedure <kind>', 'decree | vote | consensus | lottery | delegated')
  .option('--procedure-config <json>', 'procedure-specific config (JSON object)')
  .option('--visibility <policy>', 'open | closed | opaque (default open)')
  .option('--members <refs>', 'comma-separated agent ids OR names for initial members')
  .option('--at <tick>', 'tick to apply (defaults to next)')
  .action(addGroupCommand);

program
  .command('dissolve-group <worldId> <groupRef>')
  .description('Dissolve an active group (dissolve_group effect, applies next tick)')
  .option('--at <tick>', 'tick to apply (defaults to next)')
  .action(dissolveGroupCommand);

program
  .command('add-member <worldId> <groupRef> <agentRef>')
  .description('Add an agent to a group (add_member effect, applies next tick)')
  .option('--at <tick>', 'tick to apply (defaults to next)')
  .action(addMemberCommand);

program
  .command('remove-member <worldId> <groupRef> <agentRef>')
  .description('Remove an agent from a group (remove_member effect, applies next tick)')
  .option('--at <tick>', 'tick to apply (defaults to next)')
  .action(removeMemberCommand);

program
  .command('grant-authority <worldId>')
  .description(
    'Grant an authority to an agent / group / role (grant_authority effect, applies next tick)',
  )
  .requiredOption('--to-kind <kind>', 'agent | group | role')
  .requiredOption('--to-ref <ref>', 'holder id (agentId / groupId / "groupId#roleName")')
  .requiredOption('--powers <json>', 'JSON array of AuthorityPower objects')
  .option('--expires-tick <n>', 'tick at which the authority lapses (default indefinite)')
  .option('--at <tick>', 'tick to apply (defaults to next)')
  .action(grantAuthorityCommand);

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
  // CliError can carry an `action` hint — promote it into the user
  // output so the next step is obvious without reading code.
  if (err instanceof CliError && err.action) {
    console.error(`  → ${err.action}`);
  }
  if (process.env.CHRONICLE_VERBOSE === '1' && err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  console.log(`\nNEXT_STEPS
- show_user "Something went wrong. Try 'chronicle doctor' to diagnose, or rerun with CHRONICLE_VERBOSE=1 for the stack."
END_NEXT_STEPS`);
  process.exit(classifyExitCode(err));
});
