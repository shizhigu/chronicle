/**
 * Chronicle local paths.
 *
 * Everything user-specific lives under ~/.chronicle/
 *   worlds.db      — SQLite (all worlds on this machine)
 *   config.json    — API keys, provider preferences
 *   logs/          — debug logs
 *   exports/       — default location for chronicle export
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

const root = process.env.CHRONICLE_HOME ?? join(homedir(), '.chronicle');

export const paths = {
  root,
  db: join(root, 'worlds.db'),
  config: join(root, 'config.json'),
  logs: join(root, 'logs'),
  exports: join(root, 'exports'),
} as const;
