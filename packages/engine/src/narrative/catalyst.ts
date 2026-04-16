/**
 * CatalystInjector — if drama is low, nudge the world with a plausible event.
 *
 * This is the "catalyst" system from docs/USER_JOURNEY.md — when a user's run
 * is going stale, the engine injects something to spark. User never sees this
 * explicitly; they just notice "something happened."
 *
 * Catalyst pool is world-atmosphere-aware (from config.atmosphereTag).
 */

import type { World } from '@chronicle/core';
import type { WorldStore } from '../store.js';

const CATALYST_POOL: Record<string, string[]> = {
  default: [
    'A distant sound startles everyone — something moved outside.',
    'A cold draft sweeps through the space.',
    'Someone realizes they are being watched.',
    'An unexpected visitor appears briefly at the edge of the scene.',
  ],
  survival_thriller: [
    'A crack of thunder rolls across the horizon.',
    'One of the supplies is found missing.',
    'A figure is glimpsed moving in the tree line.',
    "A child's cry is heard in the distance.",
    'A flare shoots up from somewhere far away.',
  ],
  parlor_drama: [
    'A letter arrives, hand-delivered, marked URGENT.',
    'A glass is dropped and shatters — the room falls silent.',
    'The lights flicker.',
    'A phone rings. No one answers it.',
    'Someone notices a photograph missing from its frame.',
  ],
  tech_workplace: [
    'A critical bug report lands in the team chat.',
    'An investor emails: "We need to talk."',
    'The office suddenly loses internet.',
    'A competitor launches a similar product.',
    'An article drops mentioning the company — not favorably.',
  ],
  teen_drama: [
    'A rumor spreads through the hallway.',
    'A group chat screenshot starts circulating.',
    "Someone is called to the principal's office.",
    'An anonymous note appears in a locker.',
    'A new post goes viral at the school.',
  ],
  medieval_court: [
    'A messenger arrives, travel-stained and grim.',
    'A royal banner is lowered at half-mast.',
    'A bell tolls unexpectedly.',
    'A beggar speaks a prophecy at the gates.',
    'A raven lands at the window, sealed letter in its beak.',
  ],
};

export class CatalystInjector {
  constructor(
    private store: WorldStore,
    private world: World,
  ) {}

  async inject(world: World, tick: number): Promise<void> {
    const tag = world.config.atmosphereTag ?? 'default';
    const pool = CATALYST_POOL[tag] ?? CATALYST_POOL.default!;
    const idx = Math.floor(Math.random() * pool.length);
    const description = pool[idx]!;

    await this.store.recordEvent({
      worldId: world.id,
      tick,
      eventType: 'catalyst',
      actorId: null,
      data: { description, atmosphereTag: tag },
      tokenCost: 0,
    });
  }
}
