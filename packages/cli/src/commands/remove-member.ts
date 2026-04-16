/**
 * chronicle remove-member <worldId> <groupRef> <agentRef> [--at tick]
 *
 * Ergonomic wrapper over the `remove_member` effect (ADR-0011 § 3b).
 * Refuses if the target is not an active member of the group;
 * dissolved-group membership edits are rejected by the validator.
 */

import type { Effect } from '@chronicle/core';
import { GodService, WorldStore, validateEffects } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';
import { resolveAgentRef, resolveGroupRef } from '../refs.js';

interface Options {
  at?: string;
}

export async function removeMemberCommand(
  worldId: string,
  groupRef: string,
  agentRef: string,
  opts: Options,
): Promise<void> {
  const store = await WorldStore.open(paths.db);
  try {
    const world = await store.loadWorld(worldId);

    const groups = await store.getGroupsForWorld(worldId);
    const group = resolveGroupRef(groups, groupRef, 'remove-member');
    // Include dead agents: you can remove a ghost too (for cleanup).
    const agents = await store.getAllAgents(worldId);
    const agent = resolveAgentRef(agents, agentRef, 'remove-member');

    const effect: Effect = { kind: 'remove_member', groupId: group.id, agentId: agent.id };
    const validation = await validateEffects([effect], {
      store,
      world,
      tick: world.currentTick + 1,
    });
    if (validation) {
      throw new Error(humanizeRemoveMemberError(validation.reason, group.name, agent.name));
    }

    const god = new GodService(store);
    const applyAt = opts.at ? Number.parseInt(opts.at, 10) : world.currentTick + 1;
    const id = await god.queue(world, `remove ${agent.name} from group "${group.name}"`, applyAt, [
      effect,
    ]);

    console.log(
      `✓ ${agent.name} will leave group "${group.name}" at tick ${applyAt} (intervention #${id})`,
    );

    printNextSteps([
      `show_user "${agent.name} will leave '${group.name}' at tick ${applyAt}."`,
      `suggest_call "chronicle list-groups ${worldId}"`,
    ]);
  } finally {
    store.close();
  }
}

function humanizeRemoveMemberError(reason: string, groupName: string, agentName: string): string {
  // The effect validator emits `not_a_member` (not `not_member`);
  // anchor on that string rather than the CLI's intuition.
  if (reason === 'not_a_member') {
    return `remove-member: ${agentName} is not an active member of "${groupName}"`;
  }
  return `remove-member: ${reason}`;
}
