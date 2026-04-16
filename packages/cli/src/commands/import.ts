/**
 * chronicle import <file.chronicle>
 */

import { readFile } from 'node:fs/promises';
import { WorldStore } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

export async function importCommand(file: string): Promise<void> {
  const raw = await readFile(file, 'utf-8');
  const bundle = JSON.parse(raw);

  const store = await WorldStore.open(paths.db);

  await store.createWorld(bundle.world);
  for (const loc of bundle.locations ?? []) await store.createLocation(loc);
  for (const a of bundle.agents ?? []) await store.createAgent(a);
  for (const r of bundle.rules ?? []) await store.createRule(r);
  for (const e of bundle.events ?? []) {
    await store.recordEvent({
      worldId: e.worldId,
      tick: e.tick,
      eventType: e.eventType,
      actorId: e.actorId,
      data: e.data,
      visibleTo: e.visibleTo,
      tokenCost: e.tokenCost,
    });
  }

  console.log(`✓ Imported ${bundle.manifest?.worldName ?? 'world'} (${bundle.world.id})`);

  printNextSteps([
    `show_user "Imported. Run replay or fork to explore."`,
    `suggest_call "chronicle run ${bundle.world.id} --live"`,
  ]);
  store.close();
}
