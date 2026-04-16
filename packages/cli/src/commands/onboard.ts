/**
 * `chronicle onboard` — the single command a user (or Claude Code) runs first.
 *
 * It prints a NEXT-STEPS hint block — natural-language instructions that Claude
 * Code (or any capable agent) can follow to finish setup. Idempotent: rerun to
 * re-check environment; it never overwrites existing config without a prompt.
 *
 * The flow is the inverse of a typical setup wizard: instead of asking the user
 * questions, we ask *their agent* to complete the next step on their behalf.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

export function registerOnboardCommand(program: Command): void {
  program
    .command('onboard')
    .description('Initialize Chronicle on this machine — for direct users and agents alike.')
    .option('--force', 'Overwrite any existing config')
    .option('--json', 'Emit machine-readable JSON instead of prose')
    .action(async (opts) => {
      const force: boolean = opts.force ?? false;
      const asJson: boolean = opts.json ?? false;

      const state = inspectEnvironment();

      if (!state.configDirExists) {
        mkdirSync(paths.root, { recursive: true });
      }
      if (!state.worldsDirExists) {
        mkdirSync(paths.exports, { recursive: true });
      }
      if (!state.configFileExists || force) {
        writeFileSync(paths.config, defaultConfigYaml(), 'utf-8');
      }

      const nextState = inspectEnvironment();
      if (asJson) {
        process.stdout.write(
          `${JSON.stringify(
            {
              state: nextState,
              nextSteps: buildNextSteps(nextState),
            },
            null,
            2,
          )}\n`,
        );
        return;
      }

      renderPretty(nextState);
    });
}

// ============================================================
// Environment inspection
// ============================================================

interface EnvState {
  bunVersion: string | null;
  bunOk: boolean;
  configDirExists: boolean;
  configFileExists: boolean;
  worldsDirExists: boolean;
  anthropicKey: boolean;
  openAiKey: boolean;
  googleKey: boolean;
  piAgentReachable: boolean;
  chronicleHome: string;
}

function inspectEnvironment(): EnvState {
  return {
    bunVersion: typeof Bun !== 'undefined' ? Bun.version : null,
    bunOk: typeof Bun !== 'undefined' && compareVersions(Bun.version, '1.1.0') >= 0,
    configDirExists: existsSync(paths.root),
    configFileExists: existsSync(paths.config),
    worldsDirExists: existsSync(paths.exports),
    anthropicKey: !!process.env.ANTHROPIC_API_KEY,
    openAiKey: !!process.env.OPENAI_API_KEY,
    googleKey: !!process.env.GOOGLE_API_KEY,
    piAgentReachable: canResolve('@mariozechner/pi-agent-core'),
    chronicleHome: paths.root,
  };
}

function canResolve(mod: string): boolean {
  try {
    // Bun's import.meta.resolve doesn't throw on missing, so use require.resolve shim.
    // Fall back to a simple fs check for node_modules.
    const nodeRequire = (globalThis as { require?: NodeRequire }).require;
    if (nodeRequire) {
      nodeRequire.resolve(mod);
      return true;
    }
    return existsSync(join(process.cwd(), 'node_modules', mod));
  } catch {
    return false;
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n));
  const pb = b.split('.').map((n) => Number(n));
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

// ============================================================
// Next-steps synthesis (natural-language instructions for Claude Code)
// ============================================================

export function buildNextSteps(s: EnvState): string[] {
  const steps: string[] = [];

  if (!s.bunOk) {
    steps.push(
      'Install Bun ≥ 1.1.0. Run: `curl -fsSL https://bun.sh/install | bash` then restart the shell.',
    );
  }

  if (!s.anthropicKey && !s.openAiKey && !s.googleKey) {
    steps.push(
      'Export at least one LLM provider key. The cheapest path is Anthropic: `export ANTHROPIC_API_KEY=sk-…` (get one at console.anthropic.com).',
    );
  }

  if (!s.configFileExists) {
    steps.push(
      `Chronicle's config file was created at \`${paths.config}\`. Open it and edit \`defaultProvider\` / \`defaultModelId\` if you want to target OpenAI or a local model instead.`,
    );
  }

  if (!s.piAgentReachable) {
    steps.push(
      'pi-agent is not yet installed in this project. Run `bun add @mariozechner/pi-agent-core @mariozechner/pi-ai` in the project root.',
    );
  }

  // Always-present step: how to create the first world
  steps.push(
    'Create your first world with a natural-language description. Try: `chronicle create-world --desc "A dinner party where the host is lying about their fortune and five guests each have a secret."`',
  );

  steps.push(
    'Watch it unfold. After creating, run `chronicle run <world-id>` in one terminal and `chronicle dashboard` in another. Open http://localhost:7070 to see the animated view.',
  );

  return steps;
}

// ============================================================
// Pretty CLI output
// ============================================================

function renderPretty(s: EnvState): void {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.yellow('CHRONICLE'));
  lines.push(chalk.gray('───────────'));
  lines.push('');
  lines.push(`${statusIcon(s.bunOk)} Bun ${s.bunVersion ?? '(not detected)'}`);
  lines.push(`${statusIcon(s.configDirExists)} Config dir: ${chalk.gray(s.chronicleHome)}`);
  lines.push(`${statusIcon(s.configFileExists)} Config file: ${chalk.gray(paths.config)}`);
  lines.push(
    `${statusIcon(
      s.anthropicKey || s.openAiKey || s.googleKey,
    )} LLM provider key: ${providerSummary(s)}`,
  );
  lines.push(`${statusIcon(s.piAgentReachable)} pi-agent installed`);
  lines.push('');

  process.stdout.write(`${lines.join('\n')}\n`);
  printNextSteps(buildNextSteps(s));
}

function statusIcon(ok: boolean): string {
  return ok ? chalk.green('✓') : chalk.yellow('!');
}

function providerSummary(s: EnvState): string {
  const have: string[] = [];
  if (s.anthropicKey) have.push('Anthropic');
  if (s.openAiKey) have.push('OpenAI');
  if (s.googleKey) have.push('Google');
  return have.length === 0 ? chalk.yellow('none') : chalk.gray(have.join(', '));
}

// ============================================================
// Default config
// ============================================================

function defaultConfigYaml(): string {
  return `# Chronicle user config
# Generated by: chronicle onboard
# Regenerate with: chronicle onboard --force

version: 1

# Default LLM provider and model for agents.
# Override per-world in the scenario file.
defaultProvider: anthropic
defaultModelId: claude-haiku-4-5
reflectionModelId: claude-sonnet-4-6

# How many ticks between reflection cycles (null = disabled)
reflectionFrequency: 20

# Soft-rule judge uses a cheap model to keep costs bounded.
softRuleJudge:
  provider: anthropic
  modelId: claude-haiku-4-5

# Dashboard server settings (chronicle dashboard)
dashboard:
  host: localhost
  port: 7070
  wsPort: 7071

# Global safety limits. Worlds can tighten these, never loosen.
safety:
  perWorldTokenCeiling: 500000
  blockOnDeath: false
  contentFilter: moderate
`;
}
