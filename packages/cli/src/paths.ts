/**
 * Chronicle local paths.
 *
 * Everything user-specific lives under ~/.chronicle/
 *   worlds.db      — SQLite (all worlds on this machine)
 *   config.json    — API keys, provider preferences
 *   logs/          — debug logs
 *   exports/       — default location for chronicle export
 *
 * Lazily resolves `CHRONICLE_HOME` on each access so tests (and users
 * who set it per-command) get the live value rather than a frozen snapshot.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

function getRoot(): string {
  return process.env.CHRONICLE_HOME ?? join(homedir(), '.chronicle');
}

export const paths = {
  get root(): string {
    return getRoot();
  },
  get db(): string {
    return join(getRoot(), 'worlds.db');
  },
  get config(): string {
    return join(getRoot(), 'config.json');
  },
  get logs(): string {
    return join(getRoot(), 'logs');
  },
  get exports(): string {
    return join(getRoot(), 'exports');
  },
} as const;
