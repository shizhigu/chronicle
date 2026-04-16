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

export async function setConfigValue(key: string, value: string): Promise<void> {
  const cfg = await loadConfig();
  // Support dotted keys like "providers.anthropic.apiKey"
  const parts = key.split('.');
  // biome-ignore lint/suspicious/noExplicitAny: dotted-key walker needs dynamic indexing
  let target: any = cfg;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (!target[p] || typeof target[p] !== 'object') target[p] = {};
    target = target[p];
  }
  target[parts[parts.length - 1]!] = value;
  await saveConfig(cfg);
}

/**
 * Helper for commands that need an LLM: returns the resolved provider+model,
 * or throws a clear error with next-steps hint.
 */
export function resolveDefaultModel(cfg: Config): { provider: string; modelId: string } {
  if (!cfg.defaultProvider || !cfg.defaultModel) {
    throw new Error(
      'No default provider/model configured. Run `chronicle onboard` to detect available options, or edit ~/.chronicle/config.json.',
    );
  }
  return { provider: cfg.defaultProvider, modelId: cfg.defaultModel };
}

export function resolveReflectionModel(cfg: Config): { provider: string; modelId: string } {
  // If no reflection-specific model is set, fall back to the default model.
  // Users who want a stronger model for reflection point
  // `reflectionProvider` / `reflectionModel` at one.
  const provider = cfg.reflectionProvider ?? cfg.defaultProvider;
  const modelId = cfg.reflectionModel ?? cfg.defaultModel;
  if (!provider || !modelId) {
    throw new Error(
      'No reflection model configured. Run `chronicle onboard` or edit ~/.chronicle/config.json.',
    );
  }
  return { provider, modelId };
}
