/**
 * Local config: provider preferences + API key sourcing (by reference, not value).
 *
 * Stored at ~/.chronicle/config.json.
 * CLI never logs or transmits API keys — they are used in-process only.
 *
 * Philosophy: Chronicle is model-agnostic via pi-agent. We don't hardcode a
 * default provider or model. Users either:
 *   - Run `chronicle onboard` which detects what's available in their env
 *     (LM Studio server, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY,
 *     Ollama, etc.) and writes a starting config with the first-available
 *     provider, OR
 *   - Edit ~/.chronicle/config.json by hand
 *
 * If neither `defaultProvider` nor `defaultModel` is set, commands that need
 * an LLM will fail with a clear "run chronicle onboard first" error.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { CliError, ExitCode } from './exit-codes.js';
import { paths } from './paths.js';

const ConfigSchema = z.object({
  /** Provider used for per-turn agent decisions. Must match a pi-agent provider id. */
  defaultProvider: z.string().optional(),
  /** Model id within the chosen provider. Free-form — pi-agent accepts any id. */
  defaultModel: z.string().optional(),

  /** Provider for heavier, less-frequent work (reflection, world compilation). */
  reflectionProvider: z.string().optional(),
  reflectionModel: z.string().optional(),

  /** Override pi-agent's env-var lookup per provider. Never includes a literal key. */
  providers: z
    .record(
      z.object({
        apiKey: z.string().optional(), // env var name or shell `!cmd`, resolved at call time
        baseUrl: z.string().optional(),
      }),
    )
    .default({}),

  defaultBudgetUsd: z.number().optional(),
  telemetryEnabled: z.boolean().default(true),
});

export type Config = z.infer<typeof ConfigSchema>;

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await readFile(paths.config, 'utf-8');
    return ConfigSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // First-run behavior: create an empty config. `chronicle onboard` will
      // fill it in based on the user's environment.
      const fresh = ConfigSchema.parse({});
      await saveConfig(fresh);
      return fresh;
    }
    throw err;
  }
}

export async function saveConfig(cfg: Config): Promise<void> {
  await mkdir(dirname(paths.config), { recursive: true });
  await writeFile(paths.config, JSON.stringify(cfg, null, 2));
}

// Keys that must never appear in a dotted config path. Walking into
// them would poison the base Object prototype or traverse into
// config sub-objects' internal machinery.
const FORBIDDEN_KEY_PARTS = new Set(['__proto__', 'constructor', 'prototype']);

export async function setConfigValue(key: string, value: string): Promise<void> {
  const cfg = await loadConfig();
  // Support dotted keys like "providers.anthropic.apiKey"
  const parts = key.split('.');
  if (parts.length === 0 || parts.some((p) => p === '')) {
    throw new CliError(
      `config --set: invalid key '${key}' (empty segment or empty key)`,
      ExitCode.Generic,
    );
  }
  for (const p of parts) {
    if (FORBIDDEN_KEY_PARTS.has(p)) {
      throw new CliError(
        `config --set: path segment '${p}' is reserved (prototype-pollution guard)`,
        ExitCode.Generic,
      );
    }
  }

  let target = cfg as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const child = target[p];
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      target[p] = {};
    }
    target = target[p] as Record<string, unknown>;
  }

  // Coerce the string value into the shape the target schema wants.
  // CLI `--set` only ever gives us strings; without this, writing
  // `defaultBudgetUsd=5` persists `"5"` (string) which then fails
  // the Zod `z.number()` on next load and the CLI becomes unable
  // to read its own config.
  target[parts[parts.length - 1]!] = coerceValue(parts, value);

  // Validate the whole config through ConfigSchema BEFORE persisting.
  // If the new assignment produces an unreadable shape, reject here
  // rather than writing a config loadConfig() will throw on next
  // startup. The exceptions flow up with a clear Zod error message.
  try {
    ConfigSchema.parse(cfg);
  } catch (err) {
    const detail =
      err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : String(err);
    throw new CliError(
      `config --set ${key}=${value}: resulting config would be invalid — ${detail}`,
      ExitCode.Generic,
    );
  }
  await saveConfig(cfg);
}

function coerceValue(parts: string[], raw: string): unknown {
  // Known numeric leaf paths. Kept small because the schema currently
  // has only one number field; expand as ConfigSchema grows.
  const leaf = parts[parts.length - 1] ?? '';
  if (leaf === 'defaultBudgetUsd') {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) {
      throw new CliError(`config --set ${leaf}: expected a number, got '${raw}'`, ExitCode.Generic);
    }
    return n;
  }
  if (leaf === 'telemetryEnabled') {
    const lower = raw.toLowerCase().trim();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
    throw new CliError(
      `config --set telemetryEnabled: expected boolean ('true'/'false'), got '${raw}'`,
      ExitCode.Generic,
    );
  }
  // Everything else is a string (provider id, model id, api-key envvar name, etc.)
  return raw;
}

/**
 * Helper for commands that need an LLM: returns the resolved provider+model,
 * or throws a clear error with next-steps hint.
 *
 * Truthy-checks (rather than `??`) because the on-disk config file uses
 * empty strings as placeholders until the user sets real values — `??`
 * would treat `""` as a valid choice and emit an unusable request.
 */
export function resolveDefaultModel(cfg: Config): { provider: string; modelId: string } {
  const provider = cfg.defaultProvider || undefined;
  const modelId = cfg.defaultModel || undefined;
  if (!provider || !modelId) {
    throw new CliError(
      'No default provider/model configured.',
      ExitCode.ConfigError,
      'Run `chronicle onboard` to see options, then `chronicle config --set defaultProvider=<id>` and `--set defaultModel=<model>`.',
    );
  }
  return { provider, modelId };
}

/**
 * Resolve the model used for reflection / heavier world-compilation work.
 * Falls back to the default model when unset — users who want a stronger
 * model for reflection can point `reflectionProvider` / `reflectionModel`
 * at one explicitly.
 *
 * Falls through empty strings (the default config ships `""` placeholders)
 * so "never set a reflection model" and "deliberately cleared it" are the
 * same thing.
 */
export function resolveReflectionModel(cfg: Config): { provider: string; modelId: string } {
  const provider = cfg.reflectionProvider || cfg.defaultProvider;
  const modelId = cfg.reflectionModel || cfg.defaultModel;
  if (!provider || !modelId) {
    throw new CliError(
      'No reflection or default model configured.',
      ExitCode.ConfigError,
      'Run `chronicle onboard`, then `chronicle config --set defaultProvider=<id>` and `--set defaultModel=<model>` (reflection falls back to the default if unset).',
    );
  }
  return { provider, modelId };
}
