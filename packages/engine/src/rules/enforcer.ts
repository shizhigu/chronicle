/**
 * RuleEnforcer — applies compiled rules to validate agent actions.
 *
 * Three tiers (see docs/RULE_COMPILER.md):
 *   - hard: SQL-style predicates, auto-reject or auto-correct
 *   - soft: norms in agent prompts + LLM judge for violation detection
 *   - economic: deduct costs on action execution
 *
 * Authority overrides (ADR-0009 Layer 1):
 *   Before rejecting for a hard rule violation, we check whether the
 *   actor holds an `override_rule` authority targeting that rule. If
 *   so, the violation is permitted. Authority can reach the actor via
 *   three paths — direct (agent holder), role (they currently fill a
 *   role with the authority), or group (they're an active member of a
 *   group that holds it). All three resolve through the `authorities`
 *   table + `group_memberships` + `group_roles`.
 */

import type {
  Agent,
  Authority,
  AuthorityPower,
  ProposedAction,
  Rule,
  ValidationResult,
  World,
} from '@chronicle/core';

import type { WorldStore } from '../store.js';
import { evaluatePredicateSafe } from './predicate.js';

export interface ValidateArgs {
  character: Agent;
  action: ProposedAction;
}

export class RuleEnforcer {
  private rulesCache: Rule[] | null = null;
  private authoritiesCache: Authority[] | null = null;

  constructor(
    private store: WorldStore,
    private world: World,
  ) {}

  async validate(args: ValidateArgs): Promise<ValidationResult> {
    const { character, action } = args;
    const rules = await this.getActiveRules();

    const memberGroupIds = await this.memberGroupIds(character.id);
    this.memberGroupIdsForCurrentActor = memberGroupIds;

    const actorAuthorities = await this.resolveAuthoritiesForActor(character, memberGroupIds);
    const overrideIds = collectOverrideRuleIds(actorAuthorities);

    try {
      return await this.runValidation(rules, character, action, overrideIds);
    } finally {
      this.memberGroupIdsForCurrentActor = null;
    }
  }

  /**
   * Return the set of groupIds `actorId` currently belongs to.
   * Centralized so `validate()` and `judgeSoftRules()` both feed the
   * same value into scope checks + authority resolution without
   * round-tripping the DB twice.
   */
  private async memberGroupIds(actorId: string): Promise<Set<string>> {
    const memberships = await this.store.getActiveMembershipsForAgent(actorId);
    return new Set(memberships.map((m) => m.groupId));
  }

  private async runValidation(
    rules: Rule[],
    character: Agent,
    action: ProposedAction,
    overrideIds: Set<string>,
  ): Promise<ValidationResult> {
    // Evaluate all HARD rules first (blockers)
    for (const rule of rules.filter((r) => r.tier === 'hard')) {
      if (!this.isRuleInScope(rule, character, this.world)) continue;

      const result = await this.evaluateHardRule(rule, character, action);
      if (!result.ok) {
        // Authority override: the actor holds a power that waives this
        // specific rule.
        if (overrideIds.has(rule.id)) continue;
        return result;
      }
    }

    // Evaluate all ECONOMIC rules (cost calculation)
    let totalCost: ValidationResult['cost'] = {};
    for (const rule of rules.filter((r) => r.tier === 'economic')) {
      if (!this.isRuleInScope(rule, character, this.world)) continue;
      if (rule.economicActionType && rule.economicActionType !== action.actionName) continue;

      const cost = this.evaluateEconomicRule(rule, character, action);
      totalCost = mergeCosts(totalCost, cost);
    }

    // Check if character can afford
    if (totalCost.energy && character.energy < totalCost.energy) {
      return { ok: false, reason: 'insufficient_energy' };
    }
    if (totalCost.health && character.health < totalCost.health) {
      return { ok: false, reason: 'insufficient_health' };
    }
    if (
      totalCost.tokens &&
      character.tokensBudget !== null &&
      character.tokensSpent + totalCost.tokens > character.tokensBudget
    ) {
      return { ok: false, reason: 'insufficient_tokens' };
    }

    // SOFT rules don't block. They generate consequences post-action.
    // Those are evaluated by a separate judge after execution.

    return { ok: true, cost: totalCost };
  }

  /**
   * Post-action soft-rule evaluation. Returns violations that should
   * trigger reputation/relationship effects. Mirrors validate()'s
   * preamble — authority overrides waive soft rules too (an emperor
   * is still an emperor post-speech), and group-scoped soft rules
   * must only bind members of that group.
   */
  async judgeSoftRules(
    character: Agent,
    action: ProposedAction,
    _witnesses: Agent[],
  ): Promise<{ violatedRuleId: string; severity: number }[]> {
    const rules = await this.getActiveRules();
    const softRules = rules.filter((r) => r.tier === 'soft');
    const violations: { violatedRuleId: string; severity: number }[] = [];

    const memberGroupIds = await this.memberGroupIds(character.id);
    this.memberGroupIdsForCurrentActor = memberGroupIds;
    try {
      const actorAuthorities = await this.resolveAuthoritiesForActor(character, memberGroupIds);
      const overrideIds = collectOverrideRuleIds(actorAuthorities);

      for (const rule of softRules) {
        if (!this.isRuleInScope(rule, character, this.world)) continue;
        if (overrideIds.has(rule.id)) continue;
        if (!rule.softDetectionPrompt) continue;

        const judgment = await this.runJudge(rule, character, action);
        if (judgment.violated) {
          violations.push({ violatedRuleId: rule.id, severity: judgment.severity });
        }
      }
    } finally {
      this.memberGroupIdsForCurrentActor = null;
    }

    return violations;
  }

  private async getActiveRules(): Promise<Rule[]> {
    if (!this.rulesCache) {
      this.rulesCache = await this.store.getActiveRules(this.world.id);
    }
    return this.rulesCache;
  }

  private async getActiveAuthorities(): Promise<Authority[]> {
    if (!this.authoritiesCache) {
      this.authoritiesCache = await this.store.getActiveAuthoritiesForWorld(
        this.world.id,
        this.world.currentTick + 1,
      );
    }
    return this.authoritiesCache;
  }

  invalidateCache(): void {
    this.rulesCache = null;
    this.authoritiesCache = null;
  }

  /**
   * Return every authority that currently reaches `actor`, via any of:
   *   - direct (holderKind='agent', holderRef=actor.id)
   *   - role   (holderKind='role', holderRef='groupId#roleName' where
   *             actor currently fills that role)
   *   - group  (holderKind='group', holderRef=groupId where actor is
   *             an active member of that group)
   *
   * The union is the actor's effective power set for this action.
   * Computed per validate() call — authorities change infrequently so
   * a within-call scan is cheap; cross-call caching happens via
   * `authoritiesCache`.
   */
  private async resolveAuthoritiesForActor(
    actor: Agent,
    memberGroupIds: Set<string>,
  ): Promise<Authority[]> {
    const all = await this.getActiveAuthorities();
    if (all.length === 0) return [];

    // Build the set of "groupId#roleName" the actor currently holds.
    // We query per group the actor is in, which bounds the work by
    // membership count.
    const roleRefs = new Set<string>();
    for (const gid of memberGroupIds) {
      const roles = await this.store.getRolesForGroup(gid);
      for (const role of roles) {
        if (role.holderAgentId === actor.id) {
          roleRefs.add(`${gid}#${role.roleName}`);
        }
      }
    }

    return all.filter((a) => {
      if (a.holderKind === 'agent') return a.holderRef === actor.id;
      if (a.holderKind === 'group') return memberGroupIds.has(a.holderRef);
      if (a.holderKind === 'role') return roleRefs.has(a.holderRef);
      return false;
    });
  }

  private isRuleInScope(rule: Rule, character: Agent, world: World): boolean {
    // Primary scope (ADR-0009). A rule scoped to a specific group binds
    // only when the actor is a member of that group; same idea for
    // agent / location. World-scoped rules (default when unset) bind
    // everywhere.
    const scopeKind = rule.scopeKind ?? 'world';
    if (scopeKind === 'agent' && rule.scopeRef !== character.id) {
      return false;
    }
    if (scopeKind === 'location') {
      if (!character.locationId || rule.scopeRef !== character.locationId) return false;
    }
    if (scopeKind === 'group' && rule.scopeRef) {
      // We can't synchronously check group membership here; the fast
      // path is `memberGroupIdsCache` populated by the validate() pass.
      // If we haven't pre-resolved, fall through to "in scope" and let
      // the authority check still run — worst case we evaluate a rule
      // that wouldn't have bound and either pass or override.
      const cached = this.memberGroupIdsForCurrentActor;
      if (cached && !cached.has(rule.scopeRef)) return false;
    }

    // Legacy fine-grained filter on top
    if (!rule.scope) return true;

    if (rule.scope.agentIds && !rule.scope.agentIds.includes(character.id)) {
      return false;
    }
    if (rule.scope.locationIds && character.locationId) {
      if (!rule.scope.locationIds.includes(character.locationId)) return false;
    }
    if (rule.scope.timeRange) {
      const t = world.currentTick + 1;
      if (t < rule.scope.timeRange.fromTick || t > rule.scope.timeRange.toTick) {
        return false;
      }
    }
    return true;
  }

  /**
   * Transient — set during validate() so the scope check can
   * synchronously narrow by group membership without re-querying.
   */
  private memberGroupIdsForCurrentActor: Set<string> | null = null;

  private async evaluateHardRule(
    rule: Rule,
    character: Agent,
    action: ProposedAction,
  ): Promise<ValidationResult> {
    if (!rule.hardCheck) return { ok: true };

    // hardCheck is a mini-DSL evaluated against character + action + world
    const ok = evaluateHardPredicate(rule.hardCheck, { character, action, world: this.world });
    if (ok) return { ok: true };

    switch (rule.hardOnViolation) {
      case 'reject':
        return { ok: false, reason: `rule_violated:${rule.id}` };
      case 'auto_correct': {
        // attempt to derive a corrected action
        const corrected = await autoCorrectAction(rule, character, action);
        if (corrected) {
          return {
            ok: true,
            autoCorrected: { newArgs: corrected.args, note: `auto_corrected_by:${rule.id}` },
          };
        }
        return { ok: false, reason: `rule_violated:${rule.id}` };
      }
      default:
        if (rule.hardOnViolation?.startsWith('penalty:')) {
          const penaltyCost = parsePenalty(rule.hardOnViolation);
          return { ok: true, cost: penaltyCost };
        }
        return { ok: false, reason: `rule_violated:${rule.id}` };
    }
  }

  private evaluateEconomicRule(
    rule: Rule,
    character: Agent,
    action: ProposedAction,
  ): ValidationResult['cost'] {
    if (!rule.economicCostFormula) return {};
    return parseCostFormula(rule.economicCostFormula, { character, action });
  }

  private async runJudge(
    _rule: Rule,
    _character: Agent,
    _action: ProposedAction,
  ): Promise<{ violated: boolean; severity: number }> {
    // TODO: Call a cheap model (Haiku / GPT-5-mini) with the soft rule's detection prompt
    // For now, stub returning no violation.
    return { violated: false, severity: 0 };
  }
}

// ============================================================
// HELPERS
// ============================================================

function mergeCosts(a: ValidationResult['cost'], b: ValidationResult['cost']) {
  return {
    energy: (a?.energy ?? 0) + (b?.energy ?? 0) || undefined,
    tokens: (a?.tokens ?? 0) + (b?.tokens ?? 0) || undefined,
    health: (a?.health ?? 0) + (b?.health ?? 0) || undefined,
  };
}

/**
 * Flatten a set of authorities into the ruleIds they can override.
 * A wildcard `override_rule:'*'` power (not yet modeled, could be in
 * the future) would be handled here by returning a "covers all" marker;
 * for now we only recognise per-rule overrides.
 */
function collectOverrideRuleIds(authorities: Authority[]): Set<string> {
  const ids = new Set<string>();
  for (const auth of authorities) {
    for (const power of auth.powers) {
      if (isOverrideRulePower(power)) {
        ids.add(power.ruleId);
      }
    }
  }
  return ids;
}

function isOverrideRulePower(
  p: AuthorityPower,
): p is Extract<AuthorityPower, { kind: 'override_rule' }> {
  return p.kind === 'override_rule';
}

function evaluateHardPredicate(
  expr: string,
  ctx: { character: Agent; action: ProposedAction; world: World },
): boolean {
  // Flatten the action shape so compiled predicates can say `action.name`
  // (matching the tool name) and `action.args.*`. `character.*` and `world.*`
  // are passed through verbatim.
  const predicateCtx = {
    character: ctx.character,
    action: {
      name: ctx.action.actionName,
      args: ctx.action.args,
      agentId: ctx.action.agentId,
      proposedAt: ctx.action.proposedAt,
    },
    world: ctx.world,
  };
  // On malformed predicates, default to "allow" — same as before, but
  // `evaluatePredicateSafe` has proper error boundaries and logs upstream.
  return evaluatePredicateSafe(expr, predicateCtx, true);
}

async function autoCorrectAction(
  _rule: Rule,
  _character: Agent,
  _action: ProposedAction,
): Promise<{ args: Record<string, unknown> } | null> {
  // Stub — for specific known rules, apply known corrections
  return null;
}

function parsePenalty(s: string): ValidationResult['cost'] {
  // e.g. "penalty:energy=10,tokens=5"
  const body = s.slice('penalty:'.length);
  const result: Record<string, number> = {};
  for (const part of body.split(',')) {
    const [key, val] = part.split('=');
    if (key && val) result[key] = Number(val);
  }
  return result;
}

function parseCostFormula(
  formula: string,
  _ctx: { character: Agent; action: ProposedAction },
): ValidationResult['cost'] {
  // e.g. "energy=2,tokens=5" or "energy=2*len(content)"
  // TODO: real formula evaluator
  const result: Record<string, number> = {};
  for (const part of formula.split(',')) {
    const [key, val] = part.split('=');
    if (key && val) {
      const n = Number(val);
      if (!Number.isNaN(n)) result[key] = n;
    }
  }
  return result;
}
