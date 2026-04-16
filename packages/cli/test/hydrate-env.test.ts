/**
 * Tests for the startup env-hydration shim.
 *
 * Uses a fresh CHRONICLE_HOME per test so we don't touch real creds.
 * Passes an injected env object rather than mutating `process.env`, so
 * the tests don't leak state between cases.
 */

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP_HOME = mkdtempSync(join(tmpdir(), 'chronicle-hydrate-'));
process.env.CHRONICLE_HOME = TMP_HOME;

const { apiKey, saveAuth } = await import('../src/auth-storage.js');
const { hydrateEnvFromAuth } = await import('../src/hydrate-env.js');
const { paths } = await import('../src/paths.js');

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
});

beforeEach(() => {
  if (existsSync(paths.auth)) rmSync(paths.auth);
});

describe('hydrateEnvFromAuth', () => {
  it("injects a stored key into the provider's first env var", () => {
    saveAuth({ anthropic: apiKey('sk-ant-stored-xyz') });
    const env: Record<string, string | undefined> = {};
    const result = hydrateEnvFromAuth(env);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-stored-xyz');
    expect(result.injected).toEqual([{ provider: 'anthropic', envVar: 'ANTHROPIC_API_KEY' }]);
  });

  it('does NOT overwrite an env var the user already set — user override wins', () => {
    saveAuth({ anthropic: apiKey('sk-ant-from-disk') });
    const env: Record<string, string | undefined> = { ANTHROPIC_API_KEY: 'sk-ant-from-user' };
    hydrateEnvFromAuth(env);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-from-user');
  });

  it("uses the FIRST env var in the spec's priority list", () => {
    // zai's priority list is [ZAI_API_KEY, ZHIPU_API_KEY, GLM_API_KEY] — the first wins.
    saveAuth({ zai: apiKey('glm-stored') });
    const env: Record<string, string | undefined> = {};
    hydrateEnvFromAuth(env);
    expect(env.ZAI_API_KEY).toBe('glm-stored');
    expect(env.ZHIPU_API_KEY).toBeUndefined();
    expect(env.GLM_API_KEY).toBeUndefined();
  });

  it('hydrates multiple providers in one call', () => {
    saveAuth({
      anthropic: apiKey('sk-ant-1'),
      deepseek: apiKey('sk-ds-2'),
      openai: apiKey('sk-oai-3'),
    });
    const env: Record<string, string | undefined> = {};
    const result = hydrateEnvFromAuth(env);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-1');
    expect(env.DEEPSEEK_API_KEY).toBe('sk-ds-2');
    expect(env.OPENAI_API_KEY).toBe('sk-oai-3');
    expect(result.injected).toHaveLength(3);
  });

  it('skips unknown provider ids (catalog is the source of truth)', () => {
    saveAuth({ madeupvendor: apiKey('sk-x') });
    const env: Record<string, string | undefined> = {};
    const result = hydrateEnvFromAuth(env);
    expect(result.injected).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain('no env var');
  });

  it('is idempotent — calling twice has the same effect as once', () => {
    saveAuth({ anthropic: apiKey('sk-ant-abc') });
    const env: Record<string, string | undefined> = {};
    hydrateEnvFromAuth(env);
    const first = env.ANTHROPIC_API_KEY;
    hydrateEnvFromAuth(env);
    expect(env.ANTHROPIC_API_KEY).toBe(first);
  });

  it('never throws even if auth.json is completely missing', () => {
    // paths.auth does not exist; hydration should be a no-op.
    expect(existsSync(paths.auth)).toBe(false);
    const env: Record<string, string | undefined> = {};
    expect(() => hydrateEnvFromAuth(env)).not.toThrow();
    expect(Object.keys(env)).toHaveLength(0);
  });
});
