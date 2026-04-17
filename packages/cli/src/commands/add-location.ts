/**
 * chronicle add-location <worldId> --name "..." --description "..." [flags...]
 *
 * Ergonomic wrapper over the `create_location` effect (ADR-0011 § 3b).
 * Adjacency peers are passed by name as a comma-separated list; the
 * underlying effect resolves them against the world's existing
 * locations. A typo in `--adjacent` surfaces as `missing_adjacent_location`
 * from the effect validator; we humanize that below.
 */

import type { Effect } from '@chronicle/core';
import { GodService, WorldStore, validateEffects } from '@chronicle/engine';
import { resolveApplyAt } from '../apply-at.js';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  name: string;
  description: string;
  adjacent?: string;
  spriteHint?: string;
  at?: string;
}

export async function addLocationCommand(worldId: string, opts: Options): Promise<void> {
  const adjacentTo = opts.adjacent
    ? opts.adjacent
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n.length > 0)
    : undefined;

  const effect: Effect = {
    kind: 'create_location',
    name: opts.name,
    description: opts.description,
    ...(adjacentTo && adjacentTo.length > 0 ? { adjacentTo } : {}),
    ...(opts.spriteHint ? { spriteHint: opts.spriteHint } : {}),
  };

  const store = await WorldStore.open(paths.db);
  try {
    const world = await store.loadWorld(worldId);
    const validation = await validateEffects([effect], {
      store,
      world,
      tick: world.currentTick + 1,
    });
    if (validation) {
      throw new Error(humanizeAddLocationError(validation.reason, worldId));
    }

    const god = new GodService(store);
    const applyAt = resolveApplyAt(opts, world.currentTick);
    const id = await god.queue(world, `add location "${opts.name}"`, applyAt, [effect]);

    console.log(`✓ location "${opts.name}" queued for tick ${applyAt} (intervention #${id})`);
    if (adjacentTo?.length) {
      console.log(`  adjacent: ${adjacentTo.join(', ')}`);
    }
    printNextSteps([
      `show_user "Location '${opts.name}' will exist at tick ${applyAt}."`,
      `suggest_call "chronicle run ${worldId} --ticks 5 --live"`,
    ]);
  } finally {
    store.close();
  }
}

function humanizeAddLocationError(reason: string, worldId: string): string {
  if (reason.startsWith('duplicate_location_name:')) {
    const name = reason.slice('duplicate_location_name:'.length);
    return (
      `add-location: a location named "${name}" already exists in this world. ` +
      `Location names are case-insensitive; pick a different name. (${reason})`
    );
  }
  if (reason.startsWith('missing_adjacent_location:')) {
    const peer = reason.slice('missing_adjacent_location:'.length);
    return (
      `add-location: adjacent location "${peer}" does not exist in this world ` +
      `— run \`chronicle dashboard ${worldId}\` to see existing locations, ` +
      `or drop the --adjacent flag to create an isolated room. (${reason})`
    );
  }
  if (reason === 'empty_name') {
    return 'add-location: --name cannot be empty.';
  }
  return `add-location: ${reason}`;
}
