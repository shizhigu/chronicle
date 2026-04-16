/**
 * chronicle add-member <worldId> <groupRef> <agentRef> [--at tick]
 *
 * Ergonomic wrapper over the `add_member` effect (ADR-0011 § 3b).
 * Resolves both refs by id-or-name with ambiguity detection; the
 * effect validator already rejects joining a dissolved group or
 * adding an already-active member, so we rely on it for those typed
 * errors and surface them with a humanised prefix.
 */

import type { Effect } from '@chronicle/core';
import { GodService, WorldStore, validateEffects } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';
import { resolveAgentRef, resolveGroupRef } from '../refs.js';

interface Options {
  at?: string;
}

export async function addMemberCommand(
  worldId: string,
  groupRef: string,
  agentRef: string,
  opts: Options,
): Promise<void> {
  const store = await WorldStore.open(paths.db);
  try {
    const world = await store.loadWorld(worldId);

    // Include dissolved so the validator can surface a typed
    // "group_dissolved" error (better UX than a misleading "no group").
    const groups = await store.getGroupsForWorld(worldId, true);
    const group = resolveGroupRef(groups, groupRef, 'add-member');
    const agents = await store.getLiveAgents(worldId);
    const agent = resolveAgentRef(agents, agentRef, 'add-member');

    const effect: Effect = { kind: 'add_member', groupId: group.id, agentId: agent.id };
    const validation = await validateEffects([effect], {
      store,
      world,
      tick: world.currentTick + 1,
    });
    if (validation) {
      throw new Error(humanizeAddMemberError(validation.reason, group.name, agent.name));
    }

    const god = new GodService(store);
    const applyAt = opts.at ? Number.parseInt(opts.at, 10) : world.currentTick + 1;
    const id = await god.queue(world, `add ${agent.name} to group "${group.name}"`, applyAt, [
      effect,
    ]);

    console.log(
      `✓ ${agent.name} will join group "${group.name}" at tick ${applyAt} (intervention #${id})`,
    );

    printNextSteps([
      `show_user "${agent.name} will join '${group.name}' at tick ${applyAt}."`,
      `suggest_call "chronicle list-groups ${worldId}"`,
    ]);
  } finally {
    store.close();
  }
}

function humanizeAddMemberError(reason: string, groupName: string, agentName: string): string {
  if (reason === 'group_dissolved' || reason.startsWith('group_dissolved:')) {
    return `add-member: group "${groupName}" has been dissolved; cannot add members`;
  }
  if (reason === 'already_member' || reason.startsWith('already_member:')) {
    return `add-member: ${agentName} is already an active member of "${groupName}"`;
  }
  return `add-member: ${reason}`;
}
