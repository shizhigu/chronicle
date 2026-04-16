/**
 * Migration runner.
 *
 * Reads SCHEMA.sql from the repo and applies it on a fresh DB.
 * On DBs that already have the schema, checks the `schema_version`
 * table and runs incremental migrations (future).
 *
 * Runtime: Bun. Uses `bun:sqlite`.
 */

import type { Database } from 'bun:sqlite';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate(db: Database): Promise<void> {
  // Check for schema_version table; create if absent
  const hasSchema = db
    .query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`,
    )
    .get();

  if (!hasSchema) {
    // Fresh DB — apply full schema
    const schemaPath = await resolveSchemaPath();
    const ddl = await readFile(schemaPath, 'utf-8');
    db.exec(ddl);
    return;
  }

  const current =
    db
      .query<{ version: number }, []>(
        'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1',
      )
      .get()?.version ?? 0;

  const target = 1;
  if (current >= target) return;

  // Future: apply incremental migration files ./migrations/NNN.sql
  // For now we assume fresh-install only.
}

async function resolveSchemaPath(): Promise<string> {
  // Try several candidate locations (dev vs installed)
  const candidates = [
    join(__dirname, '..', '..', '..', '..', 'schema', 'SCHEMA.sql'),
    join(__dirname, '..', '..', 'schema', 'SCHEMA.sql'),
    join(process.cwd(), 'schema', 'SCHEMA.sql'),
  ];
  for (const c of candidates) {
    try {
      await readFile(c, 'utf-8');
      return c;
    } catch {
      // try next
    }
  }
  throw new Error(
    'Could not locate SCHEMA.sql. Looked in:\n' + candidates.map((c) => `  ${c}`).join('\n'),
  );
}
