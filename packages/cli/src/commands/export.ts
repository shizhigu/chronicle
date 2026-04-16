/**
 * chronicle export <worldId> --out file.chronicle
 *
 * Produces a zip-shaped directory tree (for v0.1 we just output JSON bundles).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { WorldStore } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  out: string;
}

export async function exportCommand(worldId: string, opts: Options): Promise<void> {
  const store = await WorldStore.open(paths.db);
  const world = await store.loadWorld(worldId);
  const agents = await store.getLiveAgents(worldId);
  const locations = await store.getLocationsForWorld(worldId);
  const events = await store.getRecentEvents(worldId, 0);
  const rules = await store.getActiveRules(worldId);

  const bundle = {
    manifest: {
      schemaVersion: 1,
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
  };

  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify(bundle, null, 2));

  console.log(`✓ Exported to ${opts.out}`);
  console.log(`  ${agents.length} agents · ${events.length} events · ${rules.length} rules`);

  printNextSteps([
    `show_user "Exported chronicle to ${opts.out}."`,
    `mention "Share this file with anyone who has chronicle installed."`,
    `suggest_call "chronicle import ${opts.out}"`,
  ]);
  store.close();
}
