/**
 * Hydrate `process.env` from the credential store at CLI startup.
 *
 * ### Why
 *
 * Stored credentials (`chronicle auth set anthropic --key sk-...`) live
 * in `~/.chronicle/auth.json`. But every downstream LLM call — pi-ai's
 * native provider paths, our hand-built openai-chat adapter — reads
 * keys from `process.env`. Without a bridge, `auth set` would store a
 * key no one ever reads.
 *
 * The bridge: at CLI startup, for each stored api-key credential, write
 * its value into the spec's **first** `apiKeyEnvVar` if that env var
 * isn't already set. We never clobber an existing env var — user intent
 * beats on-disk state (e.g. a CI secret override takes priority).
 *
 * ### Why not read auth.json at call time instead
 *
 * That would work, but it would mean every code path (pi-ai native,
 * our hand-built path, future OAuth flows, agent-pool workers) has to
 * know about the store. One startup shim keeps the store a pure CLI
 * concern; library-level code (compiler, engine) remains env-driven.
 *
 * ### OAuth credentials
 *
 * For now we only hydrate `api-key` credentials. OAuth tokens require
 * refresh logic before they're safe to inject; that will land alongside
 * the OAuth flow modules, not here.
 */

import { CredentialPool, findProviderSpec } from '@chronicle/core';
import type { ApiKeyCredential } from './auth-storage.js';
import { type AuthStore, listStoredProviders, loadAuth } from './auth-storage.js';

export interface HydrateResult {
  /** Provider ids whose api-key credential was injected into an env var. */
  injected: Array<{ provider: string; envVar: string; poolKeyId?: string }>;
  /** Provider ids skipped (unknown id, OAuth credential, env already set, etc). */
  skipped: Array<{ provider: string; reason: string }>;
}

/**
 * Inject stored api-key credentials into `process.env` for the current
 * process. Idempotent — safe to call more than once. Returns a summary
 * for logging / testing. Never throws; a malformed auth file that loadAuth
 * can't parse is swallowed so startup never depends on credential state.
 */
export function hydrateEnvFromAuth(
  env: Record<string, string | undefined> = process.env,
): HydrateResult {
  const result: HydrateResult = { injected: [], skipped: [] };

  let store: AuthStore;
  try {
    store = loadAuth();
  } catch {
    // Malformed auth.json is surfaced by `chronicle doctor`; we don't
    // want an unrelated command to fail its startup because of it.
    return result;
  }

  for (const providerId of listStoredProvidersSafe()) {
    const cred = store[providerId];
    if (!cred) continue;
    if (cred.type !== 'api-key') {
      result.skipped.push({ provider: providerId, reason: 'oauth credential (not hydrated)' });
      continue;
    }
    const spec = findProviderSpec(providerId);
    if (!spec || spec.apiKeyEnvVars.length === 0) {
      result.skipped.push({ provider: providerId, reason: 'no env var to hydrate into' });
      continue;
    }
    const envVar = spec.apiKeyEnvVars[0]!;
    const existing = env[envVar];
    if (typeof existing === 'string' && existing.length > 0) {
      result.skipped.push({
        provider: providerId,
        reason: `${envVar} already set (user override wins)`,
      });
      continue;
    }

    // Build a pool from the primary + any additionalKeys (ADR-0014).
    // Single-key credentials yield a pool-of-one that behaves
    // identically to the old code path. The default strategy is
    // round_robin; across process restarts each invocation starts a
    // fresh pool, so a CI loop running many `chronicle` calls will
    // naturally cycle through keys.
    const { chosen, poolKeyId } = pickFromCredential(cred);
    env[envVar] = chosen;
    result.injected.push({ provider: providerId, envVar, poolKeyId });
  }

  return result;
}

/**
 * Build a CredentialPool containing every key this credential exposes
 * (primary + additionalKeys), pick one, return (value, id). The id is
 * useful in logs / doctor output — "using key 'work'" beats "using an
 * unlabeled key".
 */
function pickFromCredential(cred: ApiKeyCredential): {
  chosen: string;
  poolKeyId: string;
} {
  const pool = new CredentialPool('round_robin');
  pool.add({ id: 'primary', value: cred.key });
  for (let i = 0; i < (cred.additionalKeys?.length ?? 0); i++) {
    const extra = cred.additionalKeys![i]!;
    const id = extra.label?.trim() || `additional_${i + 1}`;
    pool.add({ id, value: extra.key });
  }
  const picked = pool.pickAvailable();
  // pool.add just succeeded so pickAvailable cannot return null here;
  // narrow explicitly so TS is happy.
  if (!picked) {
    return { chosen: cred.key, poolKeyId: 'primary' };
  }
  return { chosen: picked.value, poolKeyId: picked.id };
}

function listStoredProvidersSafe(): string[] {
  try {
    return listStoredProviders();
  } catch {
    return [];
  }
}
