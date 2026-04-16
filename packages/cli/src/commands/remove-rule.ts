/**
 * chronicle remove-rule <worldId> <ruleId> [--at <tick>]
 *
 * Ergonomic wrapper over the `repeal_rule` effect (ADR-0011 § 3b).
 * Rejection paths worth noting:
 *
 *   - ruleId not found in the world's active rules → validation error
 *   - rule is marked inviolable (INVIOLABLE_MARKER in compilerNotes) →
 *     validation error with a clear "cannot repeal inviolable rule"
 *     message. The effect validator is the enforcement boundary; this
 *     CLI just passes through its reason string so operators see the
 *     exact guard that fired.
 */

import type { Effect } from '@chronicle/core';
import { GodService, WorldStore, validateEffects } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  at?: string;
}

export async function removeRuleCommand(
  worldId: string,
  ruleId: string,
  opts: Options,
): Promise<void> {
  const store = await WorldStore.open(paths.db);
  try {
    const world = await store.loadWorld(worldId);

    const effect: Effect = { kind: 'repeal_rule', ruleId };
    const validation = await validateEffects([effect], {
      store,
      world,
      tick: world.currentTick + 1,
    });
    if (validation) {
      throw new Error(humanizeRemoveRuleError(validation.reason, ruleId, worldId));
    }

    const god = new GodService(store);
    const applyAt = opts.at ? Number.parseInt(opts.at, 10) : world.currentTick + 1;
    const id = await god.queue(world, `repeal rule ${ruleId}`, applyAt, [effect]);

    console.log(`✓ repeal of ${ruleId} queued for tick ${applyAt} (intervention #${id})`);

    printNextSteps([
      `show_user "Rule ${ruleId} will be repealed at tick ${applyAt}."`,
      `suggest_call "chronicle run ${worldId} --ticks 5 --live"`,
    ]);
  } finally {
    store.close();
  }
}

/**
 * Translate the EffectRegistry's machine tokens into user-readable
 * sentences (ADR-0011 § CLI philosophy: errors always come with a
 * suggested fix). The raw token still appears inside parentheses so
 * it stays grep-able for post-mortems.
 */
function humanizeRemoveRuleError(reason: string, ruleId: string, worldId: string): string {
  if (reason.startsWith('no_rule:')) {
    return (
      `remove-rule: no rule with id "${ruleId}" in this world ` +
      `— run \`chronicle list-rules ${worldId}\` to see active rules. (${reason})`
    );
  }
  if (reason.startsWith('inviolable_rule:')) {
    return (
      `remove-rule: rule "${ruleId}" is marked inviolable and cannot be repealed. ` +
      'The scenario author (or the engine L0 safety set) declared it permanent. ' +
      `(${reason})`
    );
  }
  return `remove-rule: ${reason}`;
}
