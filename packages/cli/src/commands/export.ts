/**
 * chronicle export <worldId> --out file.chronicle
 *
 * Produces a JSON bundle describing everything needed to replay or
 * fork a world — world config, agents, locations, rules, events, AND
 * the per-character memory markdown files (schemaVersion 2+).
 *
 * Memory files live outside SQLite (see MemoryFileStore), so without
 * bundling them the export silently drops every character's durable
 * memory. Schema bump from 1→2 marks archives produced after the
 * file-backed memory cutover.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MemoryFileStore, WorldStore } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  out: string;
}

export interface ExportBundle {
  manifest: {
    schemaVersion: number;
    exportedAt: string;
    worldId: string;
    worldName: string;
    tickCount: number;
    rating: string;
  };
  world: Awaited<ReturnType<WorldStore['loadWorld']>>;
  agents: Awaited<ReturnType<WorldStore['getLiveAgents']>>;
  locations: Awaited<ReturnType<WorldStore['getLocationsForWorld']>>;
  rules: Awaited<ReturnType<WorldStore['getActiveRules']>>;
  events: Awaited<ReturnType<WorldStore['getRecentEvents']>>;
  /** agentId → raw contents of that character's memory.md (may be ''). */
  memories: Record<string, string>;
}

export async function exportCommand(worldId: string, opts: Options): Promise<void> {
  const store = await WorldStore.open(paths.db);
  const world = await store.loadWorld(worldId);
  const agents = await store.getLiveAgents(worldId);
  const locations = await store.getLocationsForWorld(worldId);
  const events = await store.getRecentEvents(worldId, 0);
  const rules = await store.getActiveRules(worldId);

  // Read each character's memory file in parallel. MemoryFileStore.read
  // returns '' for characters who never wrote anything, so missing
  // files are captured as empty strings rather than an error.
  const memory = new MemoryFileStore();
  const memoryEntries = await Promise.all(
    agents.map(async (a) => [a.id, await memory.read(worldId, a.id)] as const),
  );
  const memories: Record<string, string> = Object.fromEntries(memoryEntries);
  const nonEmptyMemoryCount = memoryEntries.filter(([, content]) => content.length > 0).length;

  const bundle: ExportBundle = {
    manifest: {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      worldId: world.id,
      worldName: world.name,
      tickCount: world.currentTick,
      rating: 'E', // TODO: compute from moderation results
    },
    world,
    agents,
    locations,
    rules,
    events,
    memories,
  };

  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify(bundle, null, 2));

  console.log(`✓ Exported to ${opts.out}`);
  console.log(
    `  ${agents.length} agents · ${events.length} events · ${rules.length} rules · ${nonEmptyMemoryCount} memory files`,
  );

  printNextSteps([
    `show_user "Exported chronicle to ${opts.out}."`,
    `mention "Share this file with anyone who has chronicle installed."`,
    `suggest_call "chronicle import ${opts.out}"`,
  ]);
  store.close();
}
