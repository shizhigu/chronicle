/**
 * chronicle apply-effect <worldId> --json '<effect>' [--at <tick>]
 *
 * Universal mid-run escape hatch (ADR-0011). Takes a single Effect
 * JSON (or an array via --json-array) and queues it as a god
 * intervention whose compiledEffects carry the payload. Next tick,
 * the engine routes it through EffectRegistry like any other god
 * intervention — same audit trail, same replay semantics.
 *
 * CC uses this to realize user intent whenever there's no more
 * ergonomic wrapper. Example: user says "give Carol the crown" →
 * CC composes `{ "kind": "assign_role", "groupId": "grp_crown",
 * "roleName": "monarch", "agentId": "agt_carol" }` and calls this
 * command.
 */

import type { Effect } from '@chronicle/core';
import { GodService, WorldStore, validateEffects } from '@chronicle/engine';
import { resolveApplyAt } from '../apply-at.js';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  json?: string;
  jsonArray?: string;
  at?: string;
  description?: string;
}

export async function applyEffectCommand(worldId: string, opts: Options): Promise<void> {
  const effects = parseEffects(opts);
  if (effects.length === 0) {
    throw new Error(
      'apply-effect: provide --json <Effect> (single) OR --json-array <[Effect, ...]>',
    );
  }

  const store = await WorldStore.open(paths.db);
  try {
    const world = await store.loadWorld(worldId);

    // Run EffectRegistry validate upfront so the user sees clear errors
    // at submit-time rather than at apply-time (one tick later). This
    // echoes propose(), which validates the moment a sponsor posts.
    const validation = await validateEffects(effects, {
      store,
      world,
      tick: world.currentTick + 1,
    });
    if (validation) {
      throw new Error(`apply-effect: effect[${validation.index}] invalid: ${validation.reason}`);
    }

    const god = new GodService(store);
    const applyAt = resolveApplyAt(opts, world.currentTick);
    const description = opts.description ?? summarizeEffects(effects);

    const id = await god.queue(world, description, applyAt, effects);

    console.log(`✓ Effect(s) queued for tick ${applyAt} (intervention #${id})`);
    console.log(`  ${effects.length} effect(s): ${effects.map((e) => e.kind).join(', ')}`);

    printNextSteps([
      `show_user "Queued ${effects.length} effect(s). Will apply at tick ${applyAt}."`,
      `suggest_call "chronicle run ${worldId} --ticks 5 --live"`,
    ]);
  } finally {
    store.close();
  }
}

function parseEffects(opts: Options): Effect[] {
  if (opts.json && opts.jsonArray) {
    throw new Error('apply-effect: pass either --json OR --json-array, not both');
  }
  if (opts.json) {
    const parsed = safeJsonParse(opts.json, '--json');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('apply-effect: --json must be a single Effect object');
    }
    return [parsed as Effect];
  }
  if (opts.jsonArray) {
    const parsed = safeJsonParse(opts.jsonArray, '--json-array');
    if (!Array.isArray(parsed)) {
      throw new Error('apply-effect: --json-array must be a JSON array of Effects');
    }
    return parsed as Effect[];
  }
  return [];
}

function safeJsonParse(raw: string, flagName: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`apply-effect: ${flagName} is not valid JSON — ${msg}`);
  }
}

function summarizeEffects(effects: Effect[]): string {
  if (effects.length === 1) return `apply ${effects[0]!.kind}`;
  return `apply ${effects.length} effects: ${effects.map((e) => e.kind).join(', ')}`;
}
