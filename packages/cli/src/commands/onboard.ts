/**
 * `chronicle onboard` — the single command a user (or Claude Code) runs first.
 *
 * Prints a NEXT_STEPS hint block — natural-language instructions Claude Code
 * (or any capable agent) can follow to finish setup. Idempotent; rerun to
 * re-check. Never overwrites existing config without --force.
 *
 * Chronicle does not privilege any provider. We probe everything pi-agent
 * supports (local servers + cloud providers), list what's available, and let
 * the user (or their agent) choose. No auto-pick = no brand bias.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';
import {
  BUILT_IN_PROVIDERS,
  type ProviderProbe,
  type ProviderSpec,
  availableProviders,
  detectProviders,
} from '../providers.js';

export function registerOnboardCommand(program: Command): void {
  program
    .command('onboard')
    .description('Initialize Chronicle on this machine — for direct users and agents alike.')
    .option('--force', 'Overwrite any existing config')
    .option('--json', 'Emit machine-readable JSON instead of prose')
    .action(async (opts) => {
      const force: boolean = opts.force ?? false;
      const asJson: boolean = opts.json ?? false;

      const probes = await detectProviders();
      const available = availableProviders(probes);

      const state = inspectEnvironment();
      if (!state.configDirExists) mkdirSync(paths.root, { recursive: true });
      if (!state.worldsDirExists) mkdirSync(paths.exports, { recursive: true });
      if (!state.configFileExists || force) {
        writeFileSync(paths.config, defaultConfigJson(), 'utf-8');
      }

      const finalState: FullState = { ...inspectEnvironment(), probes, available };
      const nextSteps = buildNextSteps(finalState);

      if (asJson) {
        process.stdout.write(`${JSON.stringify({ state: finalState, nextSteps }, null, 2)}\n`);
        return;
      }

      renderPretty(finalState, nextSteps);
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
  piAgentReachable: boolean;
  chronicleHome: string;
}

interface FullState extends EnvState {
  /** Every provider probed, available or not — useful for the UI table. */
  probes: ProviderProbe[];
  /** The subset that are actually usable right now. */
  available: ProviderProbe[];
}

function inspectEnvironment(): EnvState {
  return {
    bunVersion: typeof Bun !== 'undefined' ? Bun.version : null,
    bunOk: typeof Bun !== 'undefined' && compareVersions(Bun.version, '1.1.0') >= 0,
    configDirExists: existsSync(paths.root),
    configFileExists: existsSync(paths.config),
    worldsDirExists: existsSync(paths.exports),
    piAgentReachable: canResolve('@mariozechner/pi-agent-core'),
    chronicleHome: paths.root,
  };
}

function canResolve(mod: string): boolean {
  try {
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

export function buildNextSteps(s: FullState): string[] {
  const steps: string[] = [];

  if (!s.bunOk) {
    steps.push(
      'Install Bun ≥ 1.1.0. Run: `curl -fsSL https://bun.sh/install | bash` then restart the shell.',
    );
  }

  if (s.available.length === 0) {
    steps.push(`No LLM provider detected. Any of these work — Chronicle treats all equally:
${renderNoneDetected()}
Then rerun \`chronicle onboard\`.`);
  } else {
    const list = s.available
      .map((p) => {
        const model = p.suggestedModel ? ` · model ${p.suggestedModel}` : '';
        return `  - ${p.id}${model}`;
      })
      .join('\n');
    steps.push(
      `Available providers (pick one — Chronicle treats them all equally):\n${list}\n\n` +
        'Set your choice in `~/.chronicle/config.json` (`defaultProvider` + `defaultModel`),\n' +
        'or run:\n' +
        '  chronicle config --set defaultProvider=<id>\n' +
        '  chronicle config --set defaultModel=<model>',
    );
  }

  if (!s.piAgentReachable) {
    steps.push(
      'pi-agent is not yet installed in this project. Run `bun add @mariozechner/pi-agent-core @mariozechner/pi-ai`.',
    );
  }

  steps.push(
    'Create your first world: `chronicle create-world --desc "A dinner party where the host is lying about their fortune and five guests each have a secret."`',
  );
  steps.push(
    'Watch it unfold: `chronicle run <world-id>` in one terminal, `chronicle dashboard` in another. Open http://localhost:7070.',
  );

  return steps;
}

/**
 * Build the "no provider detected" suggestion block from `BUILT_IN_PROVIDERS`.
 *
 * Kept as a single helper so new catalog entries appear in the help text
 * without edits here. Groups by probe type — local servers first, then
 * api-key providers.
 */
function renderNoneDetected(): string {
  const localLines: string[] = [];
  const cloudLines: string[] = [];
  for (const spec of BUILT_IN_PROVIDERS) {
    if (spec.probe === 'server') {
      localLines.push(`    - ${spec.label}${suffixLocal(spec)}`);
    } else if (spec.authType === 'api-key') {
      const primary = spec.apiKeyEnvVars[0];
      const alts = spec.apiKeyEnvVars.slice(1);
      const altSuffix = alts.length > 0 ? ` (or ${alts.join(' / ')})` : '';
      cloudLines.push(`    - export ${primary}=...${altSuffix}   ${chalk.gray(`# ${spec.label}`)}`);
    }
  }
  return (
    '  LOCAL (runs on this machine, no API cost):\n' +
    `${localLines.join('\n')}\n` +
    '  CLOUD (paid, pay-per-token — pick any, or bring your own coding-plan token):\n' +
    cloudLines.join('\n')
  );
}

function suffixLocal(spec: ProviderSpec): string {
  if (spec.id === 'lmstudio') return ' (https://lmstudio.ai — `lms server start`)';
  if (spec.id === 'ollama') return ' (https://ollama.com — `ollama serve`)';
  if (spec.id === 'vllm') return ' (https://docs.vllm.ai — OpenAI-compatible server)';
  if (spec.id === 'llamacpp') return ' (llama.cpp server — OpenAI-compatible)';
  return '';
}

// ============================================================
// Pretty output
// ============================================================

function renderPretty(s: FullState, steps: string[]): void {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.yellow('CHRONICLE'));
  lines.push(chalk.gray('───────────'));
  lines.push('');
  lines.push(`${statusIcon(s.bunOk)} Bun ${s.bunVersion ?? '(not detected)'}`);
  lines.push(`${statusIcon(s.configDirExists)} Config dir: ${chalk.gray(s.chronicleHome)}`);
  lines.push(`${statusIcon(s.configFileExists)} Config file: ${chalk.gray(paths.config)}`);
  lines.push(`${statusIcon(s.piAgentReachable)} pi-agent installed`);
  lines.push('');
  lines.push(chalk.gray('Providers probed (all treated equally — you pick):'));
  for (const p of s.probes) {
    const icon = p.available ? chalk.green('✓') : chalk.gray('·');
    const label = p.available ? chalk.white(p.label) : chalk.gray(p.label);
    const note = p.note ? chalk.gray(` — ${p.note}`) : '';
    lines.push(`  ${icon} ${label}${note}`);
  }
  lines.push('');

  process.stdout.write(`${lines.join('\n')}\n`);
  printNextSteps(steps);
}

function statusIcon(ok: boolean): string {
  return ok ? chalk.green('✓') : chalk.yellow('!');
}

// ============================================================
// Default config — EMPTY provider/model. User picks.
// ============================================================

/**
 * Default contents of ~/.chronicle/config.json. Keys that demand a user
 * choice (provider / model) are deliberately OMITTED rather than written
 * as empty strings — an empty string reads like "user set it to blank" to
 * a human scanning the file, and the resolvers have to treat it as unset
 * anyway. Absent-key wins on both readability and robustness.
 */
function defaultConfigJson(): string {
  const cfg = {
    $schema: 'https://chronicle.sh/schemas/config-v1.json',
    providers: {},
    telemetryEnabled: true,
    dashboard: { host: 'localhost', port: 7070, wsPort: 7071 },
    safety: { perWorldTokenCeiling: 500_000, blockOnDeath: false, contentFilter: 'moderate' },
  };
  return `${JSON.stringify(cfg, null, 2)}\n`;
}
