/**
 * RuleCompiler — translate natural language rules into structured enforcement.
 *
 * Pipeline (see docs/RULE_COMPILER.md):
 *   1. Classify: tier = hard | soft | economic | ambiguous
 *   2. Per-tier parser: extract predicate/norm/cost formula
 *   3. Sanity check
 *   4. Return Rule[]
 */

import { ruleId } from '@chronicle/core';
import type { Rule, RuleScope, RuleTier } from '@chronicle/core';
import { z } from 'zod';
import { type Llm, createLlm, parseJsonResponse } from './llm.js';

const ClassificationSchema = z.object({
  tier: z.enum(['hard', 'soft', 'economic', 'ambiguous']),
  reasoning: z.string().optional(),
});

const HardRuleSchema = z.object({
  predicate: z.string(), // high-level human description of the condition
  check: z.string(), // compiled check expression (e.g., "character.alive")
  appliesToAction: z.union([z.string(), z.array(z.string())]).optional(),
  onViolation: z.enum(['reject', 'auto_correct']).or(z.string()).default('reject'),
  scope: z.record(z.any()).optional(),
});

const SoftRuleSchema = z.object({
  normText: z.string(),
  detectionPrompt: z.string(),
  consequence: z.string(),
  affectedRelationships: z
    .array(z.enum(['affection', 'trust', 'respect', 'familiarity']))
    .default([]),
  reputationDelta: z.number().default(0),
  scope: z.record(z.any()).optional(),
});

const EconomicRuleSchema = z.object({
  appliesToAction: z.string(),
  costs: z.record(z.number()).default({}),
  precondition: z.string().optional(),
  scope: z.record(z.any()).optional(),
});

export interface RuleCompilerOpts {
  provider?: string;
  modelId?: string;
  llm?: Llm;
}

export class RuleCompiler {
  private readonly llm: Llm;
  private readonly provider: string;
  private readonly modelId: string;

  constructor(opts: RuleCompilerOpts = {}) {
    this.llm = opts.llm ?? createLlm();
    this.provider = opts.provider ?? 'anthropic';
    this.modelId = opts.modelId ?? 'claude-sonnet-4-6';
  }

  async compile(worldId: string, descriptions: string[]): Promise<Rule[]> {
    const compiled: Rule[] = [];
    for (const desc of descriptions) {
      compiled.push(await this.compileOne(worldId, desc));
    }
    return compiled;
  }

  async compileOne(worldId: string, description: string): Promise<Rule> {
    const tier = await this.classify(description);
    if (tier === 'ambiguous') {
      // Graceful degrade: default to soft, leave compiler notes
      return this.buildSoftRule(
        worldId,
        description,
        {
          normText: description,
          detectionPrompt: `Has the following been violated: "${description}"? Consider context carefully.`,
          consequence: 'Socially frowned upon, may affect relationships.',
          affectedRelationships: ['trust', 'respect'],
          reputationDelta: -5,
        },
        'tier_ambiguous_defaulted_to_soft',
      );
    }

    switch (tier) {
      case 'hard':
        return this.buildHardRule(worldId, description, await this.parseHard(description));
      case 'soft':
        return this.buildSoftRule(worldId, description, await this.parseSoft(description));
      case 'economic':
        return this.buildEconomicRule(worldId, description, await this.parseEconomic(description));
    }
  }

  // ========================================================
  // Classifier
  // ========================================================

  private async classify(description: string): Promise<RuleTier | 'ambiguous'> {
    const system = `You classify simulation rules into one of three enforcement tiers.

TIER A (HARD): Engine-enforced physical laws. Impossible to violate.
Examples: "can't move if dead", "resources can't be negative", "one action per tick"

TIER B (SOFT): Social norms. Agents can violate with consequences.
Examples: "stealing is taboo", "elders are respected", "lying damages trust"

TIER C (ECONOMIC): Cost or conversion formula.
Examples: "speaking costs 1 energy", "shelter needs 10 wood", "moving takes 2 tokens"

Output JSON: { "tier": "hard"|"soft"|"economic"|"ambiguous", "reasoning": "..." }

If genuinely unclear or multi-tier, pick "ambiguous" and explain.`;
    const raw = await this.llm.call({
      provider: this.provider,
      modelId: this.modelId,
      system,
      user: `Rule: "${description}"`,
      jsonMode: true,
      temperature: 0,
    });
    const parsed = ClassificationSchema.parse(await parseJsonResponse(raw));
    return parsed.tier;
  }

  // ========================================================
  // Per-tier parsers
  // ========================================================

  private async parseHard(description: string): Promise<z.infer<typeof HardRuleSchema>> {
    const system = `You are parsing a HARD RULE for a simulation engine.
A hard rule is an engine-enforced predicate. It either blocks an action or auto-corrects it.

Output JSON:
{
  "predicate": "human-readable description of the condition",
  "check": "a short expression evaluated pre-action. Supported: 'character.alive', 'character.energy >= N', 'target.distance <= N', 'action.actionName == \\"X\\"'",
  "appliesToAction": "action name or array of names, or omit for all",
  "onViolation": "reject" | "auto_correct",
  "scope": { "locationIds": [...], "agentIds": [...], "timeRange": {...} } (optional)
}

Keep the check expression simple. Prefer simple comparisons to complex logic.`;
    const raw = await this.llm.call({
      provider: this.provider,
      modelId: this.modelId,
      system,
      user: `Rule: "${description}"\nOutput the JSON.`,
      jsonMode: true,
      temperature: 0,
    });
    return HardRuleSchema.parse(await parseJsonResponse(raw));
  }

  private async parseSoft(description: string): Promise<z.infer<typeof SoftRuleSchema>> {
    const system = `You are parsing a SOFT RULE (social norm) for a simulation engine.
A soft rule doesn't block actions but shapes behavior via agent prompts and consequences on violation.

Output JSON:
{
  "normText": "one-sentence norm to inject into agent prompts",
  "detectionPrompt": "question an LLM judge should answer to detect violations",
  "consequence": "what happens when witnessed violation occurs",
  "affectedRelationships": ["affection" | "trust" | "respect" | "familiarity"],
  "reputationDelta": number (-100 to 0),
  "scope": optional
}

Be concrete. Detection should be evaluable by looking at one action + context.`;
    const raw = await this.llm.call({
      provider: this.provider,
      modelId: this.modelId,
      system,
      user: `Rule: "${description}"\nOutput the JSON.`,
      jsonMode: true,
      temperature: 0,
    });
    return SoftRuleSchema.parse(await parseJsonResponse(raw));
  }

  private async parseEconomic(description: string): Promise<z.infer<typeof EconomicRuleSchema>> {
    const system = `You are parsing an ECONOMIC RULE (cost/conversion) for a simulation engine.

Output JSON:
{
  "appliesToAction": "the action this cost applies to",
  "costs": { "energy": number, "tokens": number, "health": number } (only include keys that apply),
  "precondition": "expression that must hold for action to be available" (optional),
  "scope": optional
}

Costs are non-negative. Don't invent keys beyond energy/tokens/health.`;
    const raw = await this.llm.call({
      provider: this.provider,
      modelId: this.modelId,
      system,
      user: `Rule: "${description}"\nOutput the JSON.`,
      jsonMode: true,
      temperature: 0,
    });
    return EconomicRuleSchema.parse(await parseJsonResponse(raw));
  }

  // ========================================================
  // Rule builders
  // ========================================================

  private buildHardRule(
    worldId: string,
    description: string,
    parsed: z.infer<typeof HardRuleSchema>,
    compilerNotes?: string,
  ): Rule {
    return {
      id: ruleId(),
      worldId,
      description,
      tier: 'hard',
      hardPredicate: parsed.predicate,
      hardCheck: parsed.check,
      hardOnViolation: parsed.onViolation,
      active: true,
      priority: 100,
      scope: parsed.scope as RuleScope | undefined,
      createdAt: new Date().toISOString(),
      createdByTick: null,
      compilerNotes: compilerNotes ?? null,
    };
  }

  private buildSoftRule(
    worldId: string,
    description: string,
    parsed: z.infer<typeof SoftRuleSchema>,
    compilerNotes?: string,
  ): Rule {
    return {
      id: ruleId(),
      worldId,
      description,
      tier: 'soft',
      softNormText: parsed.normText,
      softDetectionPrompt: parsed.detectionPrompt,
      softConsequence: parsed.consequence,
      active: true,
      priority: 100,
      scope: parsed.scope as RuleScope | undefined,
      createdAt: new Date().toISOString(),
      createdByTick: null,
      compilerNotes: compilerNotes ?? null,
    };
  }

  private buildEconomicRule(
    worldId: string,
    description: string,
    parsed: z.infer<typeof EconomicRuleSchema>,
    compilerNotes?: string,
  ): Rule {
    const formula = Object.entries(parsed.costs)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return {
      id: ruleId(),
      worldId,
      description,
      tier: 'economic',
      economicActionType: parsed.appliesToAction,
      economicCostFormula: formula,
      active: true,
      priority: 100,
      scope: parsed.scope as RuleScope | undefined,
      createdAt: new Date().toISOString(),
      createdByTick: null,
      compilerNotes: compilerNotes ?? null,
    };
  }
}
