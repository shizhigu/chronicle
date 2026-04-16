/**
 * `chronicle doctor` — diagnose the local install.
 *
 * Mentioned by the top-level error handler as the universal recovery path.
 * Provides a one-shot, no-state-mutation health check: Bun version, config
 * presence, pi-agent install, provider probes, DB reachability.
 *
 * Distinct from `onboard` — doctor NEVER writes to disk. Pure read-only.
 */

import { existsSync, statSync } from 'node:fs';
import chalk from 'chalk';
import type { Command } from 'commander';
import { listStoredProviders, loadAuth } from '../auth-storage.js';
import { loadConfig } from '../config.js';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';
import { type ProviderProbe, availableProviders, detectProviders } from '../providers.js';

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose the local Chronicle install — read-only, never mutates state.')
    .option('--json', 'Emit machine-readable JSON')
    .action(async (opts) => {
      const asJson: boolean = opts.json ?? false;

      const probes = await detectProviders();
      const available = availableProviders(probes);

      const state = await inspectState();

      const diagnosis = buildDiagnosis(state, probes, available);

      if (asJson) {
        process.stdout.write(
          `${JSON.stringify({ state, probes, available, diagnosis }, null, 2)}\n`,
        );
        return;
      }

      renderPretty(state, probes, diagnosis);
    });
}

// ============================================================
// State inspection
// ============================================================

interface DoctorState {
  bunVersion: string | null;
  bunOk: boolean;
  chronicleHome: string;
  configFileExists: boolean;
  configParseable: boolean;
  configProvider: string | null;
  configModel: string | null;
  dbFilePath: string;
  dbExists: boolean;
  dbSizeMb: number | null;
  /** Credential-store state. Never surfaces actual tokens — just presence + mode. */
  authFilePath: string;
  authFileExists: boolean;
  authFileParseable: boolean;
  authStoredProviders: string[];
  authFileModeOk: boolean;
  authFileMode: number | null;
}

async function inspectState(): Promise<DoctorState> {
  const bunVersion = typeof Bun !== 'undefined' ? Bun.version : null;
  const bunOk = bunVersion !== null && compareVersions(bunVersion, '1.1.0') >= 0;

  const configFileExists = existsSync(paths.config);
  let configParseable = false;
  let configProvider: string | null = null;
  let configModel: string | null = null;
  if (configFileExists) {
    try {
      const cfg = await loadConfig();
      configParseable = true;
      configProvider = cfg.defaultProvider ?? null;
      configModel = cfg.defaultModel ?? null;
    } catch {
      configParseable = false;
    }
  }

  const dbExists = existsSync(paths.db);
  const dbSizeMb = dbExists ? +(statSync(paths.db).size / 1e6).toFixed(2) : null;

  const authFileExists = existsSync(paths.auth);
  let authFileParseable = false;
  let authStoredProviders: string[] = [];
  let authFileMode: number | null = null;
  let authFileModeOk = true;
  if (authFileExists) {
    try {
      // Loading returns {} for empty/missing, throws for malformed — we only
      // need presence of parseability here, not the credentials themselves.
      loadAuth();
      authFileParseable = true;
      authStoredProviders = listStoredProviders();
    } catch {
      authFileParseable = false;
    }
    authFileMode = statSync(paths.auth).mode & 0o777;
    // World-readable or group-readable credential files are a red flag on
    // multi-user systems. 0600 is our contract.
    authFileModeOk = authFileMode === 0o600;
  }

  return {
    bunVersion,
    bunOk,
    chronicleHome: paths.root,
    configFileExists,
    configParseable,
    configProvider,
    configModel,
    dbFilePath: paths.db,
    dbExists,
    dbSizeMb,
    authFilePath: paths.auth,
    authFileExists,
    authFileParseable,
    authStoredProviders,
    authFileModeOk,
    authFileMode,
  };
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
// Diagnosis (problems + next steps)
// ============================================================

interface Finding {
  level: 'ok' | 'warn' | 'error';
  message: string;
  action?: string;
}

export function buildDiagnosis(
  state: DoctorState,
  _probes: ProviderProbe[],
  available: ProviderProbe[],
): Finding[] {
  const findings: Finding[] = [];

  if (!state.bunOk) {
    findings.push({
      level: 'error',
      message: `Bun ${state.bunVersion ?? 'not detected'} — need ≥ 1.1.0`,
      action: 'Install: curl -fsSL https://bun.sh/install | bash',
    });
  }

  if (!state.configFileExists) {
    findings.push({
      level: 'warn',
      message: `No config at ${state.chronicleHome}/config.json`,
      action: 'Run: chronicle onboard',
    });
  } else if (!state.configParseable) {
    findings.push({
      level: 'error',
      message: `Config file at ${state.chronicleHome}/config.json is unparseable (malformed JSON?)`,
      action: 'Inspect the file manually, or regenerate: chronicle onboard --force',
    });
  }

  if (available.length === 0) {
    findings.push({
      level: 'warn',
      message: 'No LLM provider available (no local server running, no cloud key in env)',
      action:
        'Either start a local server (LM Studio / Ollama / vLLM / ...) or export a provider key (ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY / ...).',
    });
  }

  if (state.configParseable && (!state.configProvider || !state.configModel)) {
    findings.push({
      level: 'warn',
      message: 'Config has no defaultProvider/defaultModel set',
      action:
        'chronicle config --set defaultProvider=<id> && chronicle config --set defaultModel=<model>',
    });
  }

  if (
    state.configProvider &&
    available.length > 0 &&
    !available.find((p) => p.id === state.configProvider)
  ) {
    findings.push({
      level: 'warn',
      message: `Config's defaultProvider (${state.configProvider}) is not currently available on this machine`,
      action: `Either start that provider, or switch: chronicle config --set defaultProvider=<one of ${available.map((p) => p.id).join(', ')}>`,
    });
  }

  if (state.authFileExists && !state.authFileParseable) {
    findings.push({
      level: 'error',
      message: `Credential store at ${state.authFilePath} is malformed (invalid JSON?)`,
      action:
        'Inspect the file manually — do not delete blindly, it holds saved API keys and OAuth tokens.',
    });
  }

  if (state.authFileExists && !state.authFileModeOk && state.authFileMode !== null) {
    findings.push({
      level: 'warn',
      message: `Credential store at ${state.authFilePath} has permissive mode ${state.authFileMode.toString(8)} (expected 600)`,
      action: `chmod 600 ${state.authFilePath}`,
    });
  }

  if (findings.length === 0 || findings.every((f) => f.level === 'ok')) {
    findings.push({ level: 'ok', message: 'Everything looks healthy.' });
  }

  return findings;
}

// ============================================================
// Pretty rendering
// ============================================================

function renderPretty(state: DoctorState, probes: ProviderProbe[], findings: Finding[]): void {
  const out: string[] = [];
  out.push('');
  out.push(chalk.yellow('CHRONICLE DOCTOR'));
  out.push(chalk.gray('──────────────────'));
  out.push('');

  // System
  out.push(chalk.gray('System:'));
  out.push(`  Bun:          ${statusIcon(state.bunOk)} ${state.bunVersion ?? '(not detected)'}`);
  out.push(`  Home:         ${chalk.gray(state.chronicleHome)}`);
  out.push(
    `  Config:       ${statusIcon(state.configFileExists && state.configParseable)} ${chalk.gray(paths.config)}`,
  );
  if (state.configProvider || state.configModel) {
    out.push(`    provider:   ${chalk.white(state.configProvider ?? '(unset)')}`);
    out.push(`    model:      ${chalk.white(state.configModel ?? '(unset)')}`);
  }
  out.push(
    `  DB:           ${statusIcon(state.dbExists)} ${chalk.gray(state.dbFilePath)}${
      state.dbSizeMb !== null ? chalk.gray(` (${state.dbSizeMb} MB)`) : ''
    }`,
  );
  // Credential store. We show presence + mode + provider count, never a
  // token. A red cross on mode is the user's signal to chmod before the
  // next save could leak a token to a local peer.
  const authLabel = state.authFileExists
    ? state.authFileParseable
      ? `${state.authStoredProviders.length} provider${state.authStoredProviders.length === 1 ? '' : 's'} stored`
      : 'malformed'
    : '(none — no stored credentials)';
  const authIcon = state.authFileExists
    ? state.authFileParseable && state.authFileModeOk
      ? chalk.green('✓')
      : chalk.red('✗')
    : chalk.gray('·');
  out.push(
    `  Auth:         ${authIcon} ${chalk.gray(state.authFilePath)} ${chalk.gray(`— ${authLabel}`)}`,
  );
  if (state.authStoredProviders.length > 0) {
    out.push(`    providers:  ${chalk.white(state.authStoredProviders.join(', '))}`);
  }
  out.push('');

  // Providers
  out.push(chalk.gray('Providers:'));
  for (const p of probes) {
    const icon = p.available ? chalk.green('✓') : chalk.gray('·');
    const label = p.available ? chalk.white(p.label) : chalk.gray(p.label);
    const note = p.note ? chalk.gray(` — ${p.note}`) : '';
    out.push(`  ${icon} ${label}${note}`);
  }
  out.push('');

  // Findings
  out.push(chalk.gray('Diagnosis:'));
  for (const f of findings) {
    const icon =
      f.level === 'error'
        ? chalk.red('✗')
        : f.level === 'warn'
          ? chalk.yellow('!')
          : chalk.green('✓');
    out.push(`  ${icon} ${f.message}`);
    if (f.action) {
      out.push(`      ${chalk.gray('→')} ${chalk.cyan(f.action)}`);
    }
  }
  out.push('');

  process.stdout.write(`${out.join('\n')}\n`);

  // NEXT_STEPS block for agents reading the output
  const agentSteps: string[] = [];
  for (const f of findings) {
    if (f.level !== 'ok' && f.action) {
      agentSteps.push(`suggest_call "${f.action.replace(/"/g, '\\"')}"`);
    }
  }
  if (agentSteps.length === 0) {
    agentSteps.push('mention "Everything looks healthy — no action needed."');
  }
  printNextSteps(agentSteps);
}

function statusIcon(ok: boolean): string {
  return ok ? chalk.green('✓') : chalk.yellow('!');
}
