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
const { loadConfig, saveConfig, setConfigValue } = await import('../src/config.js');
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

  it('does not write API keys to JSON without an explicit call', async () => {
    // Confirm the default-written file has no leaked key
    rmSync(paths.config);
    await loadConfig(); // recreates default
    const raw = await readFile(paths.config, 'utf-8');
    expect(raw).not.toContain('sk-');
  });
});
