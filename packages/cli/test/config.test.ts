/**
 * Config loader — ~/.chronicle/config.json.
 *
 * These tests use a temp CHRONICLE_HOME directory so they never touch the
 * user's real config. `paths` is imported once per process — if it were
 * computed dynamically we'd tear down cleanly; as-is we rely on each test
 * writing a fresh file.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP_HOME = mkdtempSync(join(tmpdir(), 'chronicle-cfg-'));

// Bun loads env before imports; set before any import of paths.js.
process.env.CHRONICLE_HOME = TMP_HOME;

// Dynamic import after env is set, so paths.ts picks up our tmpdir.
const { loadConfig, resolveDefaultModel, resolveReflectionModel, saveConfig, setConfigValue } =
  await import('../src/config.js');
const { paths } = await import('../src/paths.js');

describe('config loader', () => {
  beforeAll(() => {
    // Sanity: paths picked up our override
    expect(paths.root).toBe(TMP_HOME);
  });

  afterAll(() => {
    rmSync(TMP_HOME, { recursive: true, force: true });
  });

  it('creates an EMPTY config on first load (no provider privileged)', async () => {
    const cfg = await loadConfig();
    // Chronicle deliberately doesn't default to any provider — user or
    // onboard picks. The file still gets created so subsequent loads are
    // no-ops, but provider/model are left unset.
    expect(cfg.defaultProvider).toBeUndefined();
    expect(cfg.defaultModel).toBeUndefined();
    expect(cfg.telemetryEnabled).toBe(true);
    expect(existsSync(paths.config)).toBe(true);
  });

  it('round-trips via save', async () => {
    const cfg = await loadConfig();
    cfg.defaultProvider = 'openai';
    cfg.defaultModel = 'gpt-5-mini';
    await saveConfig(cfg);

    const reloaded = await loadConfig();
    expect(reloaded.defaultProvider).toBe('openai');
    expect(reloaded.defaultModel).toBe('gpt-5-mini');
  });

  it('setConfigValue supports dotted keys', async () => {
    await setConfigValue('providers.anthropic.apiKey', 'sk-ant-fake');
    const cfg = await loadConfig();
    expect(cfg.providers.anthropic?.apiKey).toBe('sk-ant-fake');
  });

  it('setConfigValue preserves unrelated keys', async () => {
    const before = await loadConfig();
    await setConfigValue('reflectionModel', 'my-custom-reflection-model');
    const after = await loadConfig();
    expect(after.reflectionModel).toBe('my-custom-reflection-model');
    expect(after.defaultProvider).toBe(before.defaultProvider);
    expect(after.providers.anthropic?.apiKey).toBe(before.providers.anthropic?.apiKey);
  });

  it('setConfigValue rejects __proto__ / constructor / prototype in the path (pollution guard)', async () => {
    await expect(setConfigValue('__proto__.polluted', 'yes')).rejects.toThrow(
      /reserved.*prototype-pollution/,
    );
    await expect(setConfigValue('providers.constructor', 'x')).rejects.toThrow(/reserved/);
    await expect(setConfigValue('providers.openai.prototype', 'x')).rejects.toThrow(/reserved/);
  });

  it('setConfigValue rejects empty-segment paths', async () => {
    await expect(setConfigValue('', 'x')).rejects.toThrow(/empty/);
    await expect(setConfigValue('foo..bar', 'x')).rejects.toThrow(/empty segment/);
  });

  it('setConfigValue coerces defaultBudgetUsd to a number and telemetryEnabled to a boolean', async () => {
    await setConfigValue('defaultBudgetUsd', '5.50');
    let cfg = await loadConfig();
    expect(cfg.defaultBudgetUsd).toBe(5.5);

    await setConfigValue('telemetryEnabled', 'false');
    cfg = await loadConfig();
    expect(cfg.telemetryEnabled).toBe(false);

    await setConfigValue('telemetryEnabled', 'TRUE');
    cfg = await loadConfig();
    expect(cfg.telemetryEnabled).toBe(true);
  });

  it('setConfigValue rejects values that fail schema validation before writing', async () => {
    // Before fix: this wrote `"not-a-number"` into a number field, then
    // loadConfig() threw on every subsequent invocation and the CLI
    // was bricked.
    await expect(setConfigValue('defaultBudgetUsd', 'not-a-number')).rejects.toThrow(
      /expected a number/,
    );
    await expect(setConfigValue('telemetryEnabled', 'maybe')).rejects.toThrow(/boolean/);
    // Config file survives — loadConfig() still returns a readable config.
    const cfg = await loadConfig();
    expect(cfg).toBeDefined();
  });

  it('does not write API keys to JSON without an explicit call', async () => {
    // Confirm the default-written file has no leaked key
    rmSync(paths.config);
    await loadConfig(); // recreates default
    const raw = await readFile(paths.config, 'utf-8');
    expect(raw).not.toContain('sk-');
  });
});

describe('resolveReflectionModel (the "reflection fallback was dead code" bug)', () => {
  it('falls back to default when reflection keys are UNSET', () => {
    const cfg = {
      defaultProvider: 'lmstudio',
      defaultModel: 'google/gemma-4-e4b',
      providers: {},
      telemetryEnabled: true,
    } as Parameters<typeof resolveReflectionModel>[0];
    const r = resolveReflectionModel(cfg);
    expect(r.provider).toBe('lmstudio');
    expect(r.modelId).toBe('google/gemma-4-e4b');
  });

  it('falls back to default when reflection keys are EMPTY STRINGS', () => {
    // This was the exact regression: old onboard wrote ""-placeholders, and
    // `?? defaultProvider` treated "" as set. Now it doesn't.
    const cfg = {
      defaultProvider: 'lmstudio',
      defaultModel: 'google/gemma-4-e4b',
      reflectionProvider: '',
      reflectionModel: '',
      providers: {},
      telemetryEnabled: true,
    } as Parameters<typeof resolveReflectionModel>[0];
    const r = resolveReflectionModel(cfg);
    expect(r.provider).toBe('lmstudio');
    expect(r.modelId).toBe('google/gemma-4-e4b');
  });

  it('uses reflection values when BOTH are explicitly set', () => {
    const cfg = {
      defaultProvider: 'lmstudio',
      defaultModel: 'gemma-4b',
      reflectionProvider: 'anthropic',
      reflectionModel: 'claude-opus-4-6',
      providers: {},
      telemetryEnabled: true,
    } as Parameters<typeof resolveReflectionModel>[0];
    const r = resolveReflectionModel(cfg);
    expect(r.provider).toBe('anthropic');
    expect(r.modelId).toBe('claude-opus-4-6');
  });

  it('throws a CLEAR error when neither reflection nor default is set', () => {
    const cfg = {
      providers: {},
      telemetryEnabled: true,
    } as Parameters<typeof resolveReflectionModel>[0];
    // The error is a CliError — short message, full next-step in `.action`.
    let thrown: unknown;
    try {
      resolveReflectionModel(cfg);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const err = thrown as { message: string; action?: string; code?: number };
    expect(err.message).toMatch(/reflection or default model/i);
    expect(err.action).toMatch(/chronicle onboard/);
    expect(err.action).toMatch(/defaultProvider/);
    // Contract: ConfigError exit code.
    expect(err.code).toBe(2);
  });
});

describe('resolveDefaultModel', () => {
  it('rejects empty-string placeholders (they were never a valid choice)', () => {
    const cfg = {
      defaultProvider: '',
      defaultModel: '',
      providers: {},
      telemetryEnabled: true,
    } as Parameters<typeof resolveDefaultModel>[0];
    expect(() => resolveDefaultModel(cfg)).toThrow();
  });
});
