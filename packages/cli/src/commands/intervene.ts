/**
 * chronicle intervene <worldId> --event "..."
 */

import { GodService, WorldStore } from '@chronicle/engine';
import { resolveApplyAt } from '../apply-at.js';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  event: string;
  at?: string; // optional tick to apply
}

export async function interveneCommand(worldId: string, opts: Options): Promise<void> {
  const store = await WorldStore.open(paths.db);
  const world = await store.loadWorld(worldId);
  const god = new GodService(store);

  const applyAt = resolveApplyAt(opts, world.currentTick);
  const id = await god.queue(world, opts.event, applyAt);

  console.log(`✓ Event queued for tick ${applyAt} (intervention #${id}):`);
  console.log(`  "${opts.event}"`);

  printNextSteps([
    `show_user "Event queued. Will apply at tick ${applyAt}."`,
    `suggest_call "chronicle run ${worldId} --ticks 20 --live"`,
  ]);
  store.close();
}
