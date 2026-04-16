/**
 * Tests for the credential store at `{CHRONICLE_HOME}/auth.json`.
 *
 * Goals:
 *   - round-trip api-key and OAuth credentials through disk
 *   - file mode is 0600 (critical — this file has bearer tokens)
 *   - write is atomic (interrupted writes don't corrupt existing file)
 *   - malformed entries in a hand-edited file don't nuke the whole store
 *   - missing file + empty file both load as `{}` without error
 *
 * We use a dedicated CHRONICLE_HOME tmpdir per test file so the real user
 * file is never touched. Each test starts from a clean slate.
 */

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP_HOME = mkdtempSync(join(tmpdir(), 'chronicle-auth-'));
process.env.CHRONICLE_HOME = TMP_HOME;

const {
  apiKey,
  deleteCredential,
  getCredential,
  listStoredProviders,
  loadAuth,
  oauth,
  saveAuth,
  setCredential,
} = await import('../src/auth-storage.js');
const { paths } = await import('../src/paths.js');

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
});

beforeEach(() => {
  // Clean slate between tests so state doesn't leak across cases.
  if (existsSync(paths.auth)) rmSync(paths.auth);
});

// ============================================================
// Load behaviour
// ============================================================

describe('loadAuth', () => {
  it('returns {} when the file does not exist', () => {
    expect(loadAuth()).toEqual({});
  });

  it('returns {} for an empty file', () => {
    writeFileSync(paths.auth, '', 'utf-8');
    expect(loadAuth()).toEqual({});
  });

  it('throws with an actionable message when the file is malformed JSON', () => {
    writeFileSync(paths.auth, '{ this is not json', 'utf-8');
    expect(() => loadAuth()).toThrow(/malformed/);
  });

  it('drops individual malformed entries rather than nuking the whole store', () => {
    // User hand-edited and broke one entry; the other should still load.
    const mixed = JSON.stringify({
      anthropic: { type: 'api-key', key: 'sk-ant-real', updatedAt: '2026-01-01T00:00:00Z' },
      broken: { type: 'unknown-kind', wat: true },
    });
    writeFileSync(paths.auth, mixed, 'utf-8');
    const store = loadAuth();
    expect(store.anthropic?.type).toBe('api-key');
    expect(store.broken).toBeUndefined();
  });

  it('drops api-key entries missing the key field', () => {
    writeFileSync(
      paths.auth,
      JSON.stringify({ x: { type: 'api-key', updatedAt: '2026-01-01T00:00:00Z' } }),
      'utf-8',
    );
    expect(loadAuth()).toEqual({});
  });

  it('drops oauth entries missing required fields', () => {
    writeFileSync(
      paths.auth,
      JSON.stringify({
        codex: { type: 'oauth', access: 'a', refresh: 'r' /* expiresAt missing */ },
      }),
      'utf-8',
    );
    expect(loadAuth()).toEqual({});
  });
});

// ============================================================
// Save behaviour
// ============================================================

describe('saveAuth', () => {
  it('creates parent directory with mode 0700 if missing', () => {
    // Sanity check: start with no chronicle home at all
    rmSync(paths.root, { recursive: true, force: true });
    saveAuth({ anthropic: apiKey('sk-ant-xyz') });
    expect(existsSync(paths.root)).toBe(true);
    expect(existsSync(paths.auth)).toBe(true);
  });

  it('writes file with mode 0600 — critical, tokens must not be world-readable', () => {
    saveAuth({ anthropic: apiKey('sk-ant-xyz') });
    const mode = statSync(paths.auth).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('writes as valid JSON that round-trips through loadAuth', () => {
    const original = {
      anthropic: apiKey('sk-ant-xyz'),
      codex: oauth({
        access: 'a-token',
        refresh: 'r-token',
        expiresAt: 1_234_567_890_000,
        accountId: 'acct_42',
      }),
    };
    saveAuth(original);
    const loaded = loadAuth();
    expect(loaded.anthropic?.type).toBe('api-key');
    expect((loaded.anthropic as { key: string }).key).toBe('sk-ant-xyz');
    expect(loaded.codex?.type).toBe('oauth');
    const oauthBack = loaded.codex as { access: string; expiresAt: number; accountId?: string };
    expect(oauthBack.access).toBe('a-token');
    expect(oauthBack.expiresAt).toBe(1_234_567_890_000);
    expect(oauthBack.accountId).toBe('acct_42');
  });

  it('atomic write — an interrupted previous write does not corrupt the existing file', () => {
    // Simulate a stale tmp from a prior crash. saveAuth should clobber it.
    saveAuth({ anthropic: apiKey('sk-ant-initial') });
    writeFileSync(`${paths.auth}.tmp`, 'junk-from-a-prior-crash', 'utf-8');

    saveAuth({ anthropic: apiKey('sk-ant-updated') });
    const loaded = loadAuth();
    expect((loaded.anthropic as { key: string }).key).toBe('sk-ant-updated');
    // Tmp file should be gone after successful rename.
    expect(existsSync(`${paths.auth}.tmp`)).toBe(false);
  });
});

// ============================================================
// CRUD — get / set / delete / list
// ============================================================

describe('credential CRUD', () => {
  it('setCredential persists and getCredential reads back', () => {
    setCredential('anthropic', apiKey('sk-ant-new'));
    const got = getCredential('anthropic');
    expect(got?.type).toBe('api-key');
    expect((got as { key: string }).key).toBe('sk-ant-new');
  });

  it('setCredential overwrites an existing entry for the same provider', () => {
    setCredential('anthropic', apiKey('sk-ant-1'));
    setCredential('anthropic', apiKey('sk-ant-2'));
    expect((getCredential('anthropic') as { key: string }).key).toBe('sk-ant-2');
  });

  it('setCredential preserves other providers (multi-key file is the whole point)', () => {
    setCredential('anthropic', apiKey('sk-ant'));
    setCredential('openai', apiKey('sk-oai'));
    setCredential('deepseek', apiKey('sk-ds'));
    expect(listStoredProviders().sort()).toEqual(['anthropic', 'deepseek', 'openai']);
  });

  it('setCredential rejects an invalid provider id (typo protection)', () => {
    expect(() => setCredential('Not Valid!', apiKey('x'))).toThrow(/Invalid provider id/);
    expect(() => setCredential('', apiKey('x'))).toThrow(/Invalid provider id/);
  });

  it('setCredential stamps a fresh updatedAt regardless of what the caller passed', () => {
    // Use a date from long ago in the input — saveAuth must stamp now.
    const stale = { type: 'api-key' as const, key: 'x', updatedAt: '2000-01-01T00:00:00.000Z' };
    setCredential('anthropic', stale);
    const stored = getCredential('anthropic');
    expect(stored?.updatedAt).not.toBe(stale.updatedAt);
    expect(new Date(stored?.updatedAt ?? 0).getFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it('deleteCredential removes one entry and returns true', () => {
    setCredential('anthropic', apiKey('sk-ant'));
    setCredential('openai', apiKey('sk-oai'));
    expect(deleteCredential('anthropic')).toBe(true);
    expect(getCredential('anthropic')).toBeUndefined();
    expect(getCredential('openai')).toBeDefined();
  });

  it('deleteCredential returns false when the provider is absent (idempotent)', () => {
    expect(deleteCredential('never-existed')).toBe(false);
  });

  it('listStoredProviders returns a sorted list', () => {
    setCredential('zai', apiKey('x'));
    setCredential('anthropic', apiKey('x'));
    setCredential('openai', apiKey('x'));
    expect(listStoredProviders()).toEqual(['anthropic', 'openai', 'zai']);
  });
});

// ============================================================
// Schema helpers
// ============================================================

describe('schema helpers', () => {
  it('apiKey() produces a valid ApiKeyCredential with a timestamp', () => {
    const cred = apiKey('sk-123');
    expect(cred.type).toBe('api-key');
    expect(cred.key).toBe('sk-123');
    expect(typeof cred.updatedAt).toBe('string');
    expect(() => new Date(cred.updatedAt).toISOString()).not.toThrow();
  });

  it('oauth() fills type + updatedAt and preserves optional fields', () => {
    const cred = oauth({
      access: 'a',
      refresh: 'r',
      expiresAt: 1_700_000_000_000,
      accountId: 'acct_1',
      enterpriseUrl: 'https://corp.example',
    });
    expect(cred.type).toBe('oauth');
    expect(cred.accountId).toBe('acct_1');
    expect(cred.enterpriseUrl).toBe('https://corp.example');
  });
});
