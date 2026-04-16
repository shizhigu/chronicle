/**
 * Local config: API keys, model prefs, default behavior.
 *
 * Stored at ~/.chronicle/config.json.
 * CLI never logs or transmits API keys — they are used in-process only.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { paths } from './paths.js';

const ConfigSchema = z.object({
  defaultProvider: z.string().default('anthropic'),
  defaultModel: z.string().default('claude-haiku-4-5'),
  sonnetProvider: z.string().default('anthropic'),
  sonnetModel: z.string().default('claude-sonnet-4-6'),
  providers: z
    .record(
      z.object({
        apiKey: z.string().optional(),
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
  let target: any = cfg;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (!target[p] || typeof target[p] !== 'object') target[p] = {};
    target = target[p];
  }
  target[parts[parts.length - 1]!] = value;
  await saveConfig(cfg);
}
