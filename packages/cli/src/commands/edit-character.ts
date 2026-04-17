/**
 * chronicle edit-character <worldId> <nameOrId> [flags...]
 *
 * Ergonomic wrapper over the update_agent effect (ADR-0011). Looks
 * up the target agent by id OR case-insensitive name within the
 * given world, assembles an update_agent effect from the provided
 * flags, and queues it as a god intervention. Applies next tick.
 *
 * Every flag is optional; missing flags mean "leave unchanged."
 * A literal `--mood ""` or `--private-state ""` clears the field
 * (via the effect's null semantics).
 */

import type { Effect } from '@chronicle/core';
import { GodService, WorldStore, validateEffects } from '@chronicle/engine';
import { resolveApplyAt } from '../apply-at.js';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  persona?: string;
  mood?: string;
  privateState?: string;
  traits?: string;
  at?: string;
}

export async function editCharacterCommand(
  worldId: string,
  nameOrId: string,
  opts: Options,
): Promise<void> {
  const store = await WorldStore.open(paths.db);
  try {
    const world = await store.loadWorld(worldId);
    const agents = await store.getLiveAgents(worldId);

    // Prefer exact id match; otherwise fall back to case-insensitive
    // name match. Ambiguous name (two agents with the same name) is an
    // error, not a silent first-match — CC has no way to detect a
    // silent wrong pick.
    const byId = agents.find((a) => a.id === nameOrId);
    let target = byId;
    if (!target) {
      const byName = agents.filter((a) => a.name.toLowerCase() === nameOrId.toLowerCase());
      if (byName.length > 1) {
        const ids = byName.map((a) => a.id).join(', ');
        throw new Error(
          `edit-character: ambiguous — ${byName.length} agents named "${nameOrId}" (${ids}); pass the id instead`,
        );
      }
      target = byName[0];
    }
    if (!target) {
      throw new Error(`edit-character: no agent "${nameOrId}" in world ${worldId}`);
    }

    const effect = buildUpdateEffect(target.id, opts);
    if (!effect) {
      throw new Error(
        'edit-character: pass at least one of --persona / --mood / --private-state / --traits',
      );
    }

    const validation = await validateEffects([effect], {
      store,
      world,
      tick: world.currentTick + 1,
    });
    if (validation) {
      throw new Error(`edit-character: ${validation.reason}`);
    }

    const god = new GodService(store);
    const applyAt = resolveApplyAt(opts, world.currentTick);
    const description = summarizeEdit(target.name, effect);

    const id = await god.queue(world, description, applyAt, [effect]);

    console.log(`✓ Edit to ${target.name} queued for tick ${applyAt} (intervention #${id})`);

    printNextSteps([
      `show_user "Character edit for ${target.name} queued. Will apply at tick ${applyAt}."`,
      `suggest_call "chronicle run ${worldId} --ticks 5 --live"`,
    ]);
  } finally {
    store.close();
  }
}

function buildUpdateEffect(
  agentId: string,
  opts: Options,
): Extract<Effect, { kind: 'update_agent' }> | null {
  const patch: Partial<Extract<Effect, { kind: 'update_agent' }>> = {};

  if (opts.persona !== undefined) patch.persona = opts.persona;

  // Empty string means "clear" (mapped to null). This matches the
  // effect's tri-state semantics: omitted = keep, null = clear,
  // string = set.
  if (opts.mood !== undefined) {
    patch.mood = opts.mood === '' ? null : opts.mood;
  }

  if (opts.privateState !== undefined) {
    if (opts.privateState === '') {
      patch.privateState = null;
    } else {
      const parsed = safeParse(opts.privateState, '--private-state');
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('edit-character: --private-state must be a JSON object (or "" to clear)');
      }
      patch.privateState = parsed as Record<string, unknown>;
    }
  }

  if (opts.traits !== undefined) {
    const parsed = safeParse(opts.traits, '--traits');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('edit-character: --traits must be a JSON object');
    }
    patch.traits = parsed as Record<string, number | string | boolean>;
  }

  const hasAny =
    patch.persona !== undefined ||
    patch.mood !== undefined ||
    patch.privateState !== undefined ||
    patch.traits !== undefined;
  if (!hasAny) return null;

  return { kind: 'update_agent', agentId, ...patch };
}

function safeParse(raw: string, flagName: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`edit-character: ${flagName} is not valid JSON — ${msg}`);
  }
}

function summarizeEdit(name: string, effect: Extract<Effect, { kind: 'update_agent' }>): string {
  const changed: string[] = [];
  if (effect.persona !== undefined) changed.push('persona');
  if (effect.mood !== undefined) changed.push('mood');
  if (effect.privateState !== undefined) changed.push('privateState');
  if (effect.traits !== undefined) changed.push('traits');
  return `edit ${name}: ${changed.join(', ')}`;
}
