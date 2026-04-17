/**
 * chronicle add-rule <worldId> --description "..." --tier <hard|soft|economic> [flags...]
 *
 * Ergonomic wrapper over the `create_rule` effect (ADR-0011 § 3b).
 * Composes the effect from flag values, validates through EffectRegistry,
 * and queues a god intervention whose adoption next tick creates the
 * rule. Mirrors `edit-character`'s pattern — single CLI call, next-tick
 * application, same audit path as any other god-initiated edit.
 *
 * One small ergonomic quirk worth calling out: the rule's target scope
 * (`--scope-kind`, `--scope-ref`) is optional because the common case
 * ("add a law against theft" world-wide) doesn't need it. When present,
 * the effect layer handles member-resolution / location-matching at
 * enforcer time; this CLI doesn't validate scope_ref against the world
 * — that job belongs to the effect validator.
 */

import type { Effect, RuleScopeKind, RuleTier } from '@chronicle/core';
import { GodService, WorldStore, validateEffects } from '@chronicle/engine';
import { resolveApplyAt } from '../apply-at.js';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  description: string;
  tier: string;
  // Hard-tier fields
  check?: string;
  predicate?: string;
  onViolation?: string;
  // Soft-tier field
  softNorm?: string;
  // Economic-tier fields
  economicActionType?: string;
  economicCostFormula?: string;
  // Scope (optional, ADR-0009)
  scopeKind?: string;
  scopeRef?: string;
  // Tick override
  at?: string;
}

const VALID_TIERS: readonly RuleTier[] = ['hard', 'soft', 'economic'];
const VALID_SCOPE_KINDS: readonly RuleScopeKind[] = ['world', 'group', 'agent', 'location'];

export async function addRuleCommand(worldId: string, opts: Options): Promise<void> {
  const tier = opts.tier.toLowerCase() as RuleTier;
  if (!VALID_TIERS.includes(tier)) {
    throw new Error(
      `add-rule: --tier must be one of ${VALID_TIERS.join('|')} (got "${opts.tier}")`,
    );
  }

  // Tier-specific sanity. The effect validator checks this too, but
  // catching it here gives a cleaner error message at the CLI boundary.
  if (tier === 'hard' && !opts.check) {
    throw new Error('add-rule: --check is required for --tier hard');
  }

  const scopeKind = opts.scopeKind ? (opts.scopeKind.toLowerCase() as RuleScopeKind) : undefined;
  if (scopeKind && !VALID_SCOPE_KINDS.includes(scopeKind)) {
    throw new Error(
      `add-rule: --scope-kind must be one of ${VALID_SCOPE_KINDS.join('|')} (got "${opts.scopeKind}")`,
    );
  }
  if (scopeKind && scopeKind !== 'world' && !opts.scopeRef) {
    throw new Error(`add-rule: --scope-ref is required when --scope-kind is "${scopeKind}"`);
  }

  const effect: Effect = {
    kind: 'create_rule',
    description: opts.description,
    tier,
    ...(opts.check ? { check: opts.check } : {}),
    ...(opts.predicate ? { predicate: opts.predicate } : {}),
    ...(opts.onViolation ? { onViolation: opts.onViolation } : {}),
    ...(opts.softNorm ? { softNormText: opts.softNorm } : {}),
    ...(opts.economicActionType ? { economicActionType: opts.economicActionType } : {}),
    ...(opts.economicCostFormula ? { economicCostFormula: opts.economicCostFormula } : {}),
    ...(scopeKind ? { scopeKind } : {}),
    ...(opts.scopeRef ? { scopeRef: opts.scopeRef } : {}),
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
      throw new Error(`add-rule: ${validation.reason}`);
    }

    const god = new GodService(store);
    const applyAt = resolveApplyAt(opts, world.currentTick);
    const id = await god.queue(
      world,
      `add ${tier} rule: ${truncateForLog(opts.description)}`,
      applyAt,
      [effect],
    );

    console.log(`✓ ${tier} rule queued for tick ${applyAt} (intervention #${id})`);
    console.log(`  "${truncateForLog(opts.description)}"`);

    printNextSteps([
      `show_user "Rule queued. Will apply at tick ${applyAt}."`,
      `suggest_call "chronicle run ${worldId} --ticks 5 --live"`,
    ]);
  } finally {
    store.close();
  }
}

function truncateForLog(s: string): string {
  return s.length <= 80 ? s : `${s.slice(0, 77)}...`;
}
