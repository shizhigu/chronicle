/**
 * `chronicle auth` — manage the credential store.
 *
 * User-facing surface over `auth-storage.ts`. Four actions:
 *
 *   chronicle auth list                     — list stored providers
 *   chronicle auth set <provider> [--key]   — store an api key
 *   chronicle auth delete <provider>        — remove a credential
 *   chronicle auth import-env [<provider>]  — pull from matching env vars
 *
 * Design choices:
 *
 * 1. **Never print the actual key.** `list` shows provider ids + "last
 *    rotated" times; `set` confirms with a truncated fingerprint
 *    (`sk-ant-…8f2a`). If a user wants the raw value back, they can read
 *    the file directly — at that point they've opted in to handling it.
 *
 * 2. **`set` accepts `--key` or stdin.** Interactive prompting is nice
 *    but requires a TTY; passing via stdin (`echo $KEY | chronicle auth
 *    set anthropic`) keeps it scriptable.
 *
 * 3. **`import-env` uses the catalog.** Walks `BUILT_IN_PROVIDERS`, and
 *    for each provider checks its declared `apiKeyEnvVars` list in
 *    priority order. First match per provider wins. A single-provider
 *    form (`import-env anthropic`) imports only that one.
 *
 * 4. **Unknown provider ids → `AuthError` exit code.** The catalog is the
 *    source of truth; users who want to add a custom provider should
 *    edit the catalog first (or wait for the user-config overlay).
 */

import { BUILT_IN_PROVIDERS, findProviderSpec, resolveProviderApiKey } from '@chronicle/core';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  apiKey,
  deleteCredential,
  getCredential,
  listStoredProviders,
  loadAuth,
  setCredential,
} from '../auth-storage.js';
import { CliError, ExitCode } from '../exit-codes.js';
import { printNextSteps } from '../output.js';

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command('auth')
    .description('Manage stored API keys and OAuth tokens (~/.chronicle/auth.json)');

  auth
    .command('list')
    .description('List providers with stored credentials — never prints the tokens themselves')
    .option('--json', 'Emit machine-readable JSON')
    .action(authList);

  auth
    .command('set <provider>')
    .description('Store an api key for a provider. Key via --key or stdin.')
    .option('--key <value>', 'The api key. Omit to read from stdin.')
    .action(authSet);

  auth
    .command('delete <provider>')
    .description('Remove the stored credential for a provider')
    .action(authDelete);

  auth
    .command('import-env [provider]')
    .description(
      'Import credentials from matching env vars. With no arg, imports every provider whose env vars are set.',
    )
    .action(authImportEnv);
}

// ============================================================
// list
// ============================================================

interface AuthListOpts {
  json?: boolean;
}

async function authList(opts: AuthListOpts): Promise<void> {
  const store = loadAuth();
  const ids = listStoredProviders();

  if (opts.json) {
    const summary = ids.map((id) => {
      const cred = store[id]!;
      return {
        provider: id,
        type: cred.type,
        updatedAt: cred.updatedAt,
        fingerprint: fingerprint(cred.type === 'api-key' ? cred.key : cred.access),
      };
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  if (ids.length === 0) {
    process.stdout.write(`${chalk.gray('No credentials stored.')}\n`);
    printNextSteps([
      'mention "Import from env: chronicle auth import-env"',
      'mention "Or add one explicitly: chronicle auth set <provider> --key <value>"',
    ]);
    return;
  }

  process.stdout.write(
    `${chalk.yellow('STORED CREDENTIALS')}\n${chalk.gray('────────────────────')}\n`,
  );
  for (const id of ids) {
    const cred = store[id]!;
    const when = formatWhen(cred.updatedAt);
    const fp = fingerprint(cred.type === 'api-key' ? cred.key : cred.access);
    const spec = findProviderSpec(id);
    const label = spec ? spec.label : chalk.yellow(`${id} (unknown provider)`);
    process.stdout.write(
      `  ${chalk.green('✓')} ${chalk.white(id)}  ${chalk.gray(`(${cred.type})`)}  ${chalk.gray(fp)}  ${chalk.gray(`— ${label}, updated ${when}`)}\n`,
    );
  }
  process.stdout.write('\n');
  printNextSteps([
    'mention "Remove one: chronicle auth delete <provider>"',
    'mention "File on disk (mode 0600): ~/.chronicle/auth.json"',
  ]);
}

// ============================================================
// set
// ============================================================

interface AuthSetOpts {
  key?: string;
}

async function authSet(providerId: string, opts: AuthSetOpts): Promise<void> {
  requireKnownProvider(providerId);

  const key = opts.key ?? (await readStdin()).trim();
  if (!key) {
    throw new CliError(
      'No key provided. Use --key <value> or pipe via stdin (e.g. `echo $KEY | chronicle auth set anthropic`).',
      ExitCode.ConfigError,
    );
  }

  setCredential(providerId, apiKey(key));
  process.stdout.write(
    `${chalk.green('✓')} Stored api key for ${chalk.white(providerId)} ${chalk.gray(fingerprint(key))}\n`,
  );
  printNextSteps([
    'mention "Verify: chronicle auth list"',
    `mention "Use it: chronicle config --set defaultProvider=${providerId}"`,
  ]);
}

// ============================================================
// delete
// ============================================================

async function authDelete(providerId: string): Promise<void> {
  const existed = deleteCredential(providerId);
  if (!existed) {
    throw new CliError(
      `No stored credential for provider '${providerId}'. Run 'chronicle auth list' to see stored providers.`,
      ExitCode.AuthError,
    );
  }
  process.stdout.write(`${chalk.green('✓')} Removed credential for ${chalk.white(providerId)}\n`);
}

// ============================================================
// import-env
// ============================================================

async function authImportEnv(providerId: string | undefined): Promise<void> {
  const targets = providerId
    ? findProviderSpec(providerId)
      ? [findProviderSpec(providerId)!]
      : []
    : [...BUILT_IN_PROVIDERS];

  if (providerId && targets.length === 0) {
    throw new CliError(
      `Unknown provider '${providerId}'. Run 'chronicle onboard' to see the full provider catalog.`,
      ExitCode.ConfigError,
    );
  }

  const env = process.env;
  const imported: Array<{ id: string; envVar: string }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const spec of targets) {
    if (spec.authType === 'local-server') {
      skipped.push({ id: spec.id, reason: 'local server (no credential needed)' });
      continue;
    }
    const found = resolveProviderApiKey(spec, env);
    if (!found) {
      skipped.push({
        id: spec.id,
        reason: `no env var set (${spec.apiKeyEnvVars.join(' or ')})`,
      });
      continue;
    }
    // Don't clobber a stored credential unless the env one is different.
    const existing = getCredential(spec.id);
    if (existing && existing.type === 'api-key' && existing.key === found.value) {
      skipped.push({ id: spec.id, reason: 'already stored (unchanged)' });
      continue;
    }
    setCredential(spec.id, apiKey(found.value));
    imported.push({ id: spec.id, envVar: found.envVar });
  }

  if (imported.length === 0 && providerId) {
    // User asked for a specific provider and nothing happened — explain why.
    const [s] = skipped;
    throw new CliError(
      `Nothing to import for '${providerId}': ${s?.reason ?? 'unknown reason'}`,
      ExitCode.ConfigError,
    );
  }

  process.stdout.write(`${chalk.yellow('IMPORTED')}\n`);
  if (imported.length === 0) {
    process.stdout.write(`  ${chalk.gray('(nothing — no matching env vars set)')}\n`);
  }
  for (const { id, envVar } of imported) {
    process.stdout.write(
      `  ${chalk.green('✓')} ${chalk.white(id)} ${chalk.gray(`← $${envVar}`)}\n`,
    );
  }
  if (skipped.length > 0 && !providerId) {
    process.stdout.write(
      `\n${chalk.gray(`Skipped ${skipped.length} provider(s) — nothing to import.`)}\n`,
    );
  }
  process.stdout.write('\n');
  printNextSteps([
    'mention "Verify: chronicle auth list"',
    'mention "Env vars are still honoured at runtime; this just persists them for offline use."',
  ]);
}

// ============================================================
// Helpers
// ============================================================

function requireKnownProvider(id: string): void {
  if (!findProviderSpec(id)) {
    throw new CliError(
      `Unknown provider '${id}'. Run 'chronicle onboard' to see the full provider catalog.`,
      ExitCode.ConfigError,
    );
  }
}

/**
 * Show the last 4 chars prefixed with a "…" — enough for the user to
 * recognise which key is which without leaking the rest. Short inputs
 * (<8 chars, very unlikely for a real key) get fully masked.
 */
export function fingerprint(secret: string): string {
  if (secret.length < 8) return '…';
  return `…${secret.slice(-4)}`;
}

function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return iso.slice(0, 10);
}

/** Read all of stdin as UTF-8. Returns empty string if stdin is a TTY. */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}
