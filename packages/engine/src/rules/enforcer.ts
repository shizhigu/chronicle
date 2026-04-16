/**
 * RuleEnforcer — applies compiled rules to validate agent actions.
 *
 * Three tiers (see docs/RULE_COMPILER.md):
 *   - hard: SQL-style predicates, auto-reject or auto-correct
 *   - soft: norms in agent prompts + LLM judge for violation detection
 *   - economic: deduct costs on action execution
 */

import type { Agent, ProposedAction, Rule, ValidationResult, World } from '@chronicle/core';

import type { WorldStore } from '../store.js';
import { evaluatePredicateSafe } from './predicate.js';

export interface ValidateArgs {
  character: Agent;
  action: ProposedAction;
}

export class RuleEnforcer {
  private rulesCache: Rule[] | null = null;

  constructor(
    private store: WorldStore,
    private world: World,
  ) {}

  async validate(args: ValidateArgs): Promise<ValidationResult> {
    const { character, action } = args;
    const rules = await this.getActiveRules();

    // Evaluate all HARD rules first (blockers)
    for (const rule of rules.filter((r) => r.tier === 'hard')) {
      if (!this.isRuleInScope(rule, character, this.world)) continue;

      const result = await this.evaluateHardRule(rule, character, action);
      if (!result.ok) {
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
   * trigger reputation/relationship effects.
   */
  async judgeSoftRules(
    character: Agent,
    action: ProposedAction,
    _witnesses: Agent[],
  ): Promise<{ violatedRuleId: string; severity: number }[]> {
    const rules = await this.getActiveRules();
    const softRules = rules.filter((r) => r.tier === 'soft');
    const violations: { violatedRuleId: string; severity: number }[] = [];

    for (const rule of softRules) {
      if (!this.isRuleInScope(rule, character, this.world)) continue;
      if (!rule.softDetectionPrompt) continue;

      // Use a cheap LLM judge to evaluate
      const judgment = await this.runJudge(rule, character, action);
      if (judgment.violated) {
        violations.push({ violatedRuleId: rule.id, severity: judgment.severity });
      }
    }

    return violations;
  }

  private async getActiveRules(): Promise<Rule[]> {
    if (!this.rulesCache) {
      this.rulesCache = await this.store.getActiveRules(this.world.id);
    }
    return this.rulesCache;
  }

  invalidateCache(): void {
    this.rulesCache = null;
  }

  private isRuleInScope(rule: Rule, character: Agent, world: World): boolean {
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
