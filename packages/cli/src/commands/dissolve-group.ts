/**
 * chronicle dissolve-group <worldId> <groupRef> [--at tick]
 *
 * Ergonomic wrapper over the `dissolve_group` effect (ADR-0011 § 3b).
 * Accepts the group by id OR case-insensitive name; refuses if the
 * group has already been dissolved (typed reason surfaced from the
 * effect validator).
 */

import type { Effect } from '@chronicle/core';
import { GodService, WorldStore, validateEffects } from '@chronicle/engine';
import { resolveApplyAt } from '../apply-at.js';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';
import { resolveGroupRef } from '../refs.js';

interface Options {
  at?: string;
}

export async function dissolveGroupCommand(
  worldId: string,
  groupRef: string,
  opts: Options,
): Promise<void> {
  const store = await WorldStore.open(paths.db);
  try {
    const world = await store.loadWorld(worldId);
    // includeDissolved=true so we surface a specific "already dissolved"
    // error rather than the generic "no group named X" if the user
    // re-targets a stale group.
    const groups = await store.getGroupsForWorld(worldId, true);
    const target = resolveGroupRef(groups, groupRef, 'dissolve-group');

    if (target.dissolvedTick !== null) {
      throw new Error(
        `dissolve-group: group "${target.name}" was already dissolved at tick ${target.dissolvedTick}`,
      );
    }

    const effect: Effect = { kind: 'dissolve_group', groupId: target.id };
    const validation = await validateEffects([effect], {
      store,
      world,
      tick: world.currentTick + 1,
    });
    if (validation) {
      throw new Error(`dissolve-group: ${validation.reason}`);
    }

    const god = new GodService(store);
    const applyAt = resolveApplyAt(opts, world.currentTick);
    const id = await god.queue(world, `dissolve group "${target.name}"`, applyAt, [effect]);

    console.log(
      `✓ group "${target.name}" (${target.id}) will dissolve at tick ${applyAt} (intervention #${id})`,
    );

    printNextSteps([
      `show_user "Group '${target.name}' will dissolve at tick ${applyAt}."`,
      `suggest_call "chronicle run ${worldId} --ticks 5 --live"`,
    ]);
  } finally {
    store.close();
  }
}
