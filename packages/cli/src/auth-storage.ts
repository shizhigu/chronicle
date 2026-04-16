/**
 * Credential storage — api keys and OAuth tokens on disk.
 *
 * Lives at `{CHRONICLE_HOME}/auth.json` with file mode 0600 so the user's
 * own umask can't accidentally expose it to other local users.
 *
 * ### Why this lives separately from `config.json`
 *
 * `config.json` is a prose-dumpable state file — user can paste it into a
 * bug report, we can print it in `chronicle config`, etc. Credentials
 * belong in a different blast radius: never printed, never exported with
 * `chronicle export`, never included in `.chronicle` archives.
 *
 * ### Why this file exists at all (versus reading env vars ad-hoc)
 *
 * Env vars are fine for CI and one-off invocations. But once Chronicle
 * grows OAuth flows (Codex device-code, Copilot, Anthropic PKCE), the
 * tokens MUST persist somewhere the CLI can refresh them without the
 * user re-authorising each session. That "somewhere" is this file.
 *
 * Shape + write pattern ported from pi-mono's
 * `packages/coding-agent/src/core/auth-storage.ts` and hermes-agent's
 * `hermes_cli/auth.py`. We skip the explicit file lock that both projects
 * use: Chronicle CLI invocations are strictly one-per-process and the
 * critical-section pattern here (load → mutate → atomic rename) is
 * already race-safe for single-writer use. Add locking if/when a real
 * multi-process writer appears (e.g. parallel agent-pool workers each
 * refreshing OAuth tokens concurrently).
 *
 * ### Atomic write
 *
 * Writes go to `auth.json.tmp` and `rename(2)` into place. Rename is
 * atomic on POSIX filesystems — readers either see the old file or the
 * new one, never a truncated mid-write. Mode 0600 is set on the tmp file
 * before the rename so the final file is never briefly world-readable.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { paths } from './paths.js';

// ============================================================
// Credential shape
// ============================================================

/** A stored api key. `updatedAt` lets us surface "last rotated" in UI. */
export interface ApiKeyCredential {
  type: 'api-key';
  key: string;
  updatedAt: string;
  /**
   * Additional same-provider keys to pool with the primary (ADR-0014).
   * Optional + backward-compatible — old files without this field load
   * as "single-key" and behave exactly as before. Each extra key may
   * carry a human-readable `label` for diagnostics (e.g. "work",
   * "personal"); omitted labels default to positional ids.
   */
  additionalKeys?: Array<{ key: string; label?: string }>;
}

/**
 * A stored OAuth credential set. Matches pi-mono's shape so credentials
 * exported from pi-agent tools can be imported into Chronicle and
 * vice-versa (a goal we want to keep alive to ease migration).
 *
 * `expiresAt` is a UNIX epoch millisecond timestamp.
 */
export interface OAuthCredential {
  type: 'oauth';
  /** Short-lived bearer token. */
  access: string;
  /** Long-lived refresh token. Rotates per vendor. */
  refresh: string;
  /** Epoch ms when `access` stops being valid. */
  expiresAt: number;
  updatedAt: string;
  /** Optional — some vendors scope tokens to an account or enterprise. */
  accountId?: string;
  enterpriseUrl?: string;
}

export type AuthCredential = ApiKeyCredential | OAuthCredential;

/**
 * Whole-file shape. Keyed by canonical provider id (matches
 * `@chronicle/core`'s `ProviderSpec.id`). Value is one credential record.
 *
 * One credential per provider — if a user rotates from api-key to OAuth
 * for the same provider, the new record replaces the old. This keeps the
 * file shape trivial; fancier cases (multi-account) can be added when a
 * real use case arrives.
 */
export type AuthStore = Record<string, AuthCredential>;

// ============================================================
// Load / save
// ============================================================

/**
 * Read `auth.json`. Returns `{}` if the file doesn't exist. Throws on
 * malformed JSON so callers can decide whether to surface the corruption
 * (usually they should — silently dropping credentials is worse than an
 * actionable error).
 */
export function loadAuth(): AuthStore {
  if (!existsSync(paths.auth)) return {};
  const raw = readFileSync(paths.auth, 'utf-8');
  if (raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normaliseStore(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Credential store at ${paths.auth} is malformed (${msg}). Fix or remove the file manually — we won't silently drop saved credentials.`,
    );
  }
}

/**
 * Write the full store atomically. Creates the parent directory if
 * missing. Sets mode 0600 on the tmp file *before* the rename so the
 * final file is never briefly world-readable on systems with a permissive
 * umask.
 */
export function saveAuth(store: AuthStore): void {
  const root = dirname(paths.auth);
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }

  const tmp = `${paths.auth}.tmp`;
  const body = `${JSON.stringify(store, null, 2)}\n`;

  try {
    writeFileSync(tmp, body, { encoding: 'utf-8', mode: 0o600 });
    // Defensive: writeFileSync honours `mode` when creating, but some
    // filesystems / umasks trim it. Re-chmod to be sure.
    chmodSync(tmp, 0o600);
    renameSync(tmp, paths.auth);
  } catch (err) {
    // Clean up the partial tmp file so subsequent writes don't trip.
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp);
      } catch {
        /* best effort */
      }
    }
    throw err;
  }
}

// ============================================================
// Mutators
// ============================================================

export function getCredential(providerId: string): AuthCredential | undefined {
  return loadAuth()[providerId];
}

export function setCredential(providerId: string, cred: AuthCredential): void {
  validateProviderId(providerId);
  const store = loadAuth();
  store[providerId] = withUpdatedAt(cred);
  saveAuth(store);
}

export function deleteCredential(providerId: string): boolean {
  const store = loadAuth();
  if (!(providerId in store)) return false;
  delete store[providerId];
  saveAuth(store);
  return true;
}

/** List providers that currently have stored credentials. */
export function listStoredProviders(): string[] {
  return Object.keys(loadAuth()).sort();
}

// ============================================================
// Convenience constructors
// ============================================================

export function apiKey(
  key: string,
  additionalKeys?: Array<{ key: string; label?: string }>,
): ApiKeyCredential {
  const cred: ApiKeyCredential = {
    type: 'api-key',
    key,
    updatedAt: new Date().toISOString(),
  };
  if (additionalKeys && additionalKeys.length > 0) {
    cred.additionalKeys = additionalKeys;
  }
  return cred;
}

export function oauth(cred: Omit<OAuthCredential, 'type' | 'updatedAt'>): OAuthCredential {
  return { type: 'oauth', updatedAt: new Date().toISOString(), ...cred };
}

// ============================================================
// Internals
// ============================================================

function validateProviderId(id: string): void {
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    throw new Error(
      `Invalid provider id '${id}'. Expected lowercase alphanumeric + dashes (matches ProviderSpec.id).`,
    );
  }
}

function withUpdatedAt(cred: AuthCredential): AuthCredential {
  return { ...cred, updatedAt: new Date().toISOString() };
}

/**
 * Validate + normalise a freshly-parsed JSON value into `AuthStore`.
 * Drops entries that don't match the expected credential shape rather
 * than failing the whole load — if someone hand-edited the file and
 * broke one provider, the rest should still be usable.
 */
function normaliseStore(raw: unknown): AuthStore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: AuthStore = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const cred = normaliseCredential(value);
    if (cred) out[id] = cred;
  }
  return out;
}

function normaliseCredential(value: unknown): AuthCredential | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const type = v.type;
  const updatedAt = typeof v.updatedAt === 'string' ? v.updatedAt : new Date(0).toISOString();

  if (type === 'api-key' && typeof v.key === 'string' && v.key.length > 0) {
    const out: ApiKeyCredential = { type: 'api-key', key: v.key, updatedAt };
    // Validate + normalise the additionalKeys list if present. Drop
    // entries that don't look like key objects rather than failing the
    // whole load — same philosophy as normaliseStore.
    if (Array.isArray(v.additionalKeys)) {
      const extras: Array<{ key: string; label?: string }> = [];
      for (const entry of v.additionalKeys) {
        if (
          entry &&
          typeof entry === 'object' &&
          typeof (entry as { key?: unknown }).key === 'string' &&
          (entry as { key: string }).key.length > 0
        ) {
          const e = entry as { key: string; label?: unknown };
          const item: { key: string; label?: string } = { key: e.key };
          if (typeof e.label === 'string') item.label = e.label;
          extras.push(item);
        }
      }
      if (extras.length > 0) out.additionalKeys = extras;
    }
    return out;
  }
  if (
    type === 'oauth' &&
    typeof v.access === 'string' &&
    typeof v.refresh === 'string' &&
    typeof v.expiresAt === 'number'
  ) {
    const out: OAuthCredential = {
      type: 'oauth',
      access: v.access,
      refresh: v.refresh,
      expiresAt: v.expiresAt,
      updatedAt,
    };
    if (typeof v.accountId === 'string') out.accountId = v.accountId;
    if (typeof v.enterpriseUrl === 'string') out.enterpriseUrl = v.enterpriseUrl;
    return out;
  }
  return null;
}
