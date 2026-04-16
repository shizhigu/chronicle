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
import { evaluatePredicate } from '@chronicle/engine';
import { z } from 'zod';
import { type Llm, createLlm, parseJsonResponse } from './llm.js';

const ClassificationSchema = z.object({
  tier: z.enum(['hard', 'soft', 'economic', 'ambiguous']),
  reasoning: z.string().optional(),
});

/**
 * `scope` is an optional shaping clause on rules. LLMs at the 4B-ish size
 * routinely return a prose string ("applies to all agents") or an array
 * where an object is expected — perfectly defensible interpretations of
 * the natural-language prompt that would otherwise crash the compile with
 * an unreadable Zod dump.
 *
 * Preprocess: if it's not a plain object, drop it silently. Callers that
 * need to distinguish "user scoped this rule" from "we couldn't parse the
 * scope" can inspect `compilerNotes` — we leave a marker there in the
 * builder functions.
 */
const LooseScope = z.preprocess((raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return undefined;
}, z.record(z.any()).optional());

const HardRuleSchema = z.object({
  predicate: z.string(), // high-level human description of the condition
  check: z.string(), // compiled check expression (e.g., "character.alive")
  appliesToAction: z.union([z.string(), z.array(z.string())]).optional(),
  onViolation: z.enum(['reject', 'auto_correct']).or(z.string()).default('reject'),
  scope: LooseScope,
});

const SoftRuleSchema = z.object({
  normText: z.string(),
  detectionPrompt: z.string(),
  consequence: z.string(),
  affectedRelationships: z
    .array(z.enum(['affection', 'trust', 'respect', 'familiarity']))
    .default([]),
  reputationDelta: z.number().default(0),
  scope: LooseScope,
});

const EconomicRuleSchema = z.object({
  appliesToAction: z.string(),
  costs: z.record(z.number()).default({}),
  precondition: z.string().optional(),
  scope: LooseScope,
});

// ============================================================
// DSL grammar reference — given to the LLM verbatim so its output
// is guaranteed to be evaluable by the runtime. Kept close to the
// actual implementation in @chronicle/engine/rules/predicate.ts.
// ============================================================

const HARD_RULE_SYSTEM_PROMPT = `You are parsing a HARD RULE for a simulation engine.
A hard rule is an engine-enforced predicate. It either blocks an action or auto-corrects it.

## Output JSON shape

{
  "predicate": "human-readable description of the condition",
  "check": "a DSL expression evaluated pre-action (see grammar below)",
  "appliesToAction": "action name or array of names, or omit for all",
  "onViolation": "reject" | "auto_correct",
  "scope": { "locationIds": [...], "agentIds": [...], "timeRange": {...} } (optional)
}

## The "check" DSL

The check expression must evaluate to a boolean. It is checked against the context
object { character, action, world } just BEFORE the proposed action is applied.

Supported operators, in precedence order (low → high):
  ||          logical or
  &&          logical and
  !           logical not (prefix)
  in          membership (left value in right array or substring-in-string)
  == != >= <= > <    comparison
  + -         arithmetic (or string concat for +)
  * / %       arithmetic
  -           unary minus

Paths: dotted access (\`character.energy\`), bracket indexing (\`character.inventory[0]\`,
\`character.traits["boldness"]\`). The pseudo-property \`.length\` works on strings and
arrays.

Whitelisted methods (only these are callable):
  \`.includes(s)\`      on strings or arrays
  \`.startsWith(s)\`    on strings
  \`.endsWith(s)\`      on strings
  \`.toLowerCase()\`    on strings
  \`.toUpperCase()\`    on strings
  \`.trim()\`           on strings

Literals: numbers (\`5\`, \`1.5\`), strings (\`"abc"\`, \`'x'\`), booleans (\`true\`, \`false\`),
\`null\`, \`undefined\`. No other identifiers reachable — cannot call arbitrary JS.

## Context object shape

character: { id, name, alive, energy, health, mood, locationId, role, traits, ...custom }
action:    { name, args, agentId, proposedAt }
world:     { currentTick, atmosphere, ...config }

## Examples (copy these patterns)

- "actor must be alive"              →  \`character.alive\`
- "min energy 5 to do anything"      →  \`character.energy >= 5\`
- "remaining energy after cost ≥ 0"  →  \`character.energy - action.cost >= 0\`
- "message ≤ 280 chars"              →  \`action.args.content.length <= 280\`
- "target must be an ally"           →  \`action.args.target in character.allies\`
- "no forbidden word"                →  \`!action.args.content.includes("password")\`
- "@-mentions only"                  →  \`action.args.content.startsWith("@")\`
- "case-insensitive match"           →  \`character.mood.toLowerCase() == "enraged"\`
- "admin override"                   →  \`character.role == "admin" || character.energy >= 100\`

## Rules for your output

1. Use ONLY the operators, paths, and methods listed above.
2. Do NOT use function calls other than the whitelist.
3. Do NOT reference identifiers other than \`character\`, \`action\`, \`world\`, or literals.
4. Prefer simple expressions. If a rule is complex, split it or make it a soft rule.
5. Output the JSON only — no prose.`;

/** Returns an error message if the expression can't parse, or null if OK. */
function tryValidateDsl(expr: string): string | null {
  try {
    // Pass a shallow context; we only need to know the parser accepts the syntax.
    // Semantic errors (like missing fields) don't matter here — runtime will
    // short-circuit those gracefully.
    evaluatePredicate(expr, { character: {}, action: {}, world: {} });
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Filter: Zod/type errors at eval time aren't parse errors; a true parse
    // error surfaces as PredicateError. Best-effort distinguish.
    if (/PredicateError/.test(err?.constructor?.name ?? '') || /at position/.test(msg)) {
      return msg;
    }
    // Anything else is likely a runtime issue, not a parse issue — accept.
    return null;
  }
}

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
    // If a custom Llm is injected (typically in tests), provider/modelId are
    // ignored by the mock; use empty strings so we don't leak a brand bias
    // into the default. In production, callers pass provider/modelId
    // explicitly (see WorldCompiler + run.ts / dashboard.ts wiring).
    this.provider = opts.provider ?? '';
    this.modelId = opts.modelId ?? '';
    if (!opts.llm && (!this.provider || !this.modelId)) {
      throw new Error(
        'RuleCompiler requires { provider, modelId } when using the default createLlm(). Pass them explicitly or inject a custom Llm.',
      );
    }
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
      case 'hard': {
        const { parsed, dslWarning } = await this.parseHard(description);
        return this.buildHardRule(worldId, description, parsed, dslWarning);
      }
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

  private async parseHard(
    description: string,
  ): Promise<{ parsed: z.infer<typeof HardRuleSchema>; dslWarning?: string }> {
    const system = HARD_RULE_SYSTEM_PROMPT;
    const userPrompt = `Rule: "${description}"\nOutput the JSON.`;

    // First attempt
    const raw = await this.llm.call({
      provider: this.provider,
      modelId: this.modelId,
      system,
      user: userPrompt,
      jsonMode: true,
      temperature: 0,
    });
    let parsed = HardRuleSchema.parse(await parseJsonResponse(raw));

    // Validate the `check` expression against the DSL parser. If the LLM emits
    // syntax the runtime can't evaluate, retry once with the parser's error
    // so the model can correct itself. If still bad, fall back to a safe
    // default and surface the issue so the caller sets compilerNotes.
    const firstError = tryValidateDsl(parsed.check);
    if (!firstError) return { parsed };

    const retryRaw = await this.llm.call({
      provider: this.provider,
      modelId: this.modelId,
      system,
      user: `${userPrompt}\n\nYour previous output's "check" field failed to parse: ${firstError}\nThe DSL grammar is described above. Emit a corrected JSON.`,
      jsonMode: true,
      temperature: 0,
    });
    try {
      parsed = HardRuleSchema.parse(await parseJsonResponse(retryRaw));
    } catch {
      // Keep the original parse; downstream will still fall back.
    }

    const retryError = tryValidateDsl(parsed.check);
    if (!retryError) return { parsed };

    return {
      parsed: { ...parsed, check: 'character.alive' },
      dslWarning: `dsl_unparseable_fallback:${retryError}`,
    };
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
    // Final defense: even after parseHard's retry + fallback, re-validate.
    const dslError = tryValidateDsl(parsed.check);
    const safeCheck = dslError ? 'character.alive' : parsed.check;
    const warning = dslError ? `dsl_unparseable_fallback:${dslError}` : null;
    const notes =
      warning && compilerNotes
        ? `${compilerNotes}; ${warning}`
        : (warning ?? compilerNotes ?? null);

    return {
      id: ruleId(),
      worldId,
      description,
      tier: 'hard',
      hardPredicate: parsed.predicate,
      hardCheck: safeCheck,
      hardOnViolation: parsed.onViolation,
      active: true,
      priority: 100,
      scope: parsed.scope as RuleScope | undefined,
      createdAt: new Date().toISOString(),
      createdByTick: null,
      compilerNotes: notes,
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
