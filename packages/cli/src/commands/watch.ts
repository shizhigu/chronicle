/**
 * chronicle watch <worldId>
 *
 * Tail recent events without advancing the simulation.
 */

import { WorldStore } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

export async function watchCommand(worldId: string): Promise<void> {
  const store = await WorldStore.open(paths.db);
  const world = await store.loadWorld(worldId);
  const events = await store.getRecentEvents(worldId, Math.max(0, world.currentTick - 20));

  console.log(`[${world.name}] tick ${world.currentTick}, status=${world.status}`);
  console.log('');
  for (const e of events) {
    const actor = e.actorId ? e.actorId.slice(-6) : 'world';
    console.log(
      `  [${String(e.tick).padStart(4)}] ${e.eventType.padEnd(18)} ${actor}  ${JSON.stringify(e.data).slice(0, 80)}`,
    );
  }

  printNextSteps([`suggest_call "chronicle run ${worldId} --ticks 20 --live"`]);
  store.close();
}
