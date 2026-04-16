/**
 * GodService — user (god) interventions.
 *
 * Users queue natural-language events: "a storm hits" / "the stranger
 * returns". On each tick, interventions queued for that tick (or earlier
 * and unapplied) are broadcast to agents as an event AND, if a
 * structured `compiledEffects.effects` array is present, routed through
 * the shared EffectRegistry (ADR-0009 Layer 2). That way a god
 * intervention is literally a proposal that skips the voting step —
 * same executor, same audit trail, same replay behavior.
 */

import type { Effect, GodIntervention, World } from '@chronicle/core';
import { applyEffects } from '../governance/effects.js';
import type { WorldStore } from '../store.js';

export class GodService {
  constructor(private store: WorldStore) {}

  /**
   * Queue a god intervention. With only a `description`, the intervention
   * is a narrative event broadcast to all agents. With `effects`, it ALSO
   * carries a compiled effect list that executes through EffectRegistry
   * when the intervention fires — mid-run edits from CC use this path.
   */
  async queue(
    world: World,
    description: string,
    applyAtTick?: number,
    effects?: Effect[],
  ): Promise<number> {
    const queuedTick = world.currentTick;
    const effectiveTick = applyAtTick ?? queuedTick + 1;
    return this.store.queueIntervention({
      worldId: world.id,
      queuedTick,
      applyAtTick: effectiveTick,
      description,
      compiledEffects: effects && effects.length > 0 ? { effects } : null,
      notes: null,
    });
  }

  async getQueuedFor(worldId: string, tick: number): Promise<GodIntervention[]> {
    return this.store.getPendingInterventions(worldId, tick);
  }

  /**
   * Apply an intervention. `tick` is the in-progress tick (usually
   * `nextTick` from the engine's tick loop, because `world.currentTick`
   * hasn't been advanced yet when interventions run). Callers without
   * an explicit tick fall back to `world.currentTick`.
   *
   * If `iv.compiledEffects.effects` is a non-empty array of valid
   * Effect records, each one is executed through EffectRegistry. The
   * results appear in the broadcast event's `data.effectResults` so
   * dashboards / replay can see what mechanically changed.
   */
  async applyEffects(world: World, iv: GodIntervention, tick?: number): Promise<void> {
    const effectiveTick = tick ?? world.currentTick;
    const agents = await this.store.getLiveAgents(world.id);
    const visibleTo = agents.map((a) => a.id);

    // Layer-2 structured effects, if the intervention carries them.
    const structured = extractEffects(iv.compiledEffects);
    const effectResults = structured.length
      ? await applyEffects(structured, {
          store: this.store,
          world,
          tick: effectiveTick,
          sourceEventId: null,
        })
      : [];

    await this.store.recordEvent({
      worldId: world.id,
      tick: effectiveTick,
      eventType: 'god_intervention',
      actorId: null,
      data: {
        description: iv.description,
        compiled: iv.compiledEffects,
        effectResults,
      },
      visibleTo,
      tokenCost: 0,
    });
  }

  async markApplied(id: number): Promise<void> {
    await this.store.markInterventionApplied(id);
  }
}

/**
 * Pull a validated `Effect[]` out of an intervention's
 * `compiledEffects` bag. The field is historically a free-form JSON
 * object; Layer 2 adds the convention `{ effects: Effect[] }` without
 * changing the schema, so older interventions keep working.
 */
function extractEffects(compiled: Record<string, unknown> | null): Effect[] {
  if (!compiled || typeof compiled !== 'object') return [];
  const raw = (compiled as { effects?: unknown }).effects;
  if (!Array.isArray(raw)) return [];
  // We trust the upstream compiler here — if an effect kind is unknown
  // EffectRegistry will throw at execute time and the result will show
  // the failure in the audit event. No silent coercion.
  return raw as Effect[];
}
