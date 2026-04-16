/**
 * WorldCompiler — natural-language description → full world config + entities.
 *
 * Output goes straight into the DB via WorldStore. One call to produce the
 * whole thing (world, characters, locations, rules, actions, initial scene).
 */

import {
  type ActionSchema,
  type Agent,
  type Location,
  type Resource,
  type World,
  type WorldConfig,
  actionId,
  agentId,
  locationId,
  randomSeed,
  resourceId,
  worldId,
} from '@chronicle/core';
import { z } from 'zod';
import { type Llm, createLlm, parseJsonResponse } from './llm.js';
import { RuleCompiler } from './rule-compiler.js';

const CompiledWorldSchema = z.object({
  name: z.string(),
  atmosphere: z.string(),
  atmosphereTag: z.string(),
  scale: z.enum(['small', 'medium', 'large']),
  tickDurationDescription: z.string().optional(),
  dayNightCycleTicks: z.number().int().nullable().optional(),

  sharedSystemPrompt: z.string(),

  characters: z
    .array(
      z.object({
        name: z.string(),
        age: z.number().int().optional(),
        persona: z.string(), // full narrative description
        shortDescription: z.string(), // one line for list displays
        traits: z.record(z.union([z.number(), z.string(), z.boolean()])).default({}),
        privateState: z.record(z.any()).optional(),
        startingMood: z.string().optional(),
        startingLocationName: z.string(),
      }),
    )
    .min(2)
    .max(50),

  locations: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        spriteHint: z.string().optional(),
        affordances: z.array(z.string()).default([]),
        adjacentTo: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(20),

  resources: z
    .array(
      z.object({
        type: z.string(),
        initialQuantity: z.number(),
        atLocationName: z.string().optional(),
        perAgent: z.boolean().default(false),
      }),
    )
    .default([]),

  rules: z.array(z.string()).default([]),

  actions: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        parameters: z.record(z.any()).default({}),
        baseCost: z
          .object({
            energy: z.number().optional(),
            tokens: z.number().optional(),
            health: z.number().optional(),
          })
          .default({}),
        visibility: z.string().default('public'),
        availableTo: z.array(z.string()).optional(), // character names, default all
      }),
    )
    .default([]),

  initialScene: z.string(),
});

export type CompiledWorld = z.infer<typeof CompiledWorldSchema>;

export interface WorldCompilerOpts {
  provider?: string;
  modelId?: string;
  llm?: Llm;
}

export class WorldCompiler {
  private readonly llm: Llm;
  private readonly provider: string;
  private readonly modelId: string;
  private readonly ruleCompiler: RuleCompiler;

  constructor(opts: WorldCompilerOpts = {}) {
    this.llm = opts.llm ?? createLlm();
    this.provider = opts.provider ?? 'anthropic';
    this.modelId = opts.modelId ?? 'claude-sonnet-4-6';
    this.ruleCompiler = new RuleCompiler({
      provider: this.provider,
      modelId: this.modelId,
      llm: this.llm,
    });
  }

  async parseDescription(description: string): Promise<CompiledWorld> {
    const system = buildWorldCompilerSystemPrompt();
    const user = `User description:\n\n"${description}"\n\nReturn a complete compiled world as JSON.`;
    const raw = await this.llm.call({
      provider: this.provider,
      modelId: this.modelId,
      system,
      user,
      jsonMode: true,
      temperature: 0.4, // some creativity for character generation
      maxTokens: 8192,
    });
    return CompiledWorldSchema.parse(await parseJsonResponse(raw));
  }

  /**
   * Persist a compiled world to the store. Returns the world ID.
   */
  async persist(
    store: import('@chronicle/engine').WorldStore,
    compiled: CompiledWorld,
    opts: {
      description: string;
      defaultProvider: string;
      defaultModelId: string;
    },
  ): Promise<string> {
    const id = worldId();
    const seed = randomSeed();

    const config: WorldConfig = {
      atmosphere: compiled.atmosphere,
      atmosphereTag: compiled.atmosphereTag,
      scale: compiled.scale,
      mapLayout: { kind: 'graph', locations: compiled.locations.map((l) => l.name) },
      defaultModelId: opts.defaultModelId,
      defaultProvider: opts.defaultProvider,
      reflectionFrequency: 20,
      dramaCatalystEnabled: true,
    };

    const world: World = {
      id,
      name: compiled.name,
      description: opts.description,
      systemPrompt: compiled.sharedSystemPrompt,
      config,
      currentTick: 0,
      status: 'created',
      godBudgetTokens: null,
      tokensUsed: 0,
      tickDurationDescription: compiled.tickDurationDescription ?? null,
      dayNightCycleTicks: compiled.dayNightCycleTicks ?? null,
      createdAt: new Date().toISOString(),
      createdByChronicle: null,
      forkFromTick: null,
      rngSeed: seed,
    };

    await store.createWorld(world);

    // Locations (create before agents so location ids exist)
    const locationByName = new Map<string, string>();
    for (const locSpec of compiled.locations) {
      const lid = locationId();
      locationByName.set(locSpec.name, lid);
      const loc: Location = {
        id: lid,
        worldId: id,
        name: locSpec.name,
        description: locSpec.description,
        x: null,
        y: null,
        parentId: null,
        affordances: locSpec.affordances,
        metadata: {},
        spriteHint: locSpec.spriteHint ?? null,
        createdAt: new Date().toISOString(),
      };
      await store.createLocation(loc);
    }

    // Adjacencies
    for (const locSpec of compiled.locations) {
      const from = locationByName.get(locSpec.name)!;
      for (const adjName of locSpec.adjacentTo) {
        const to = locationByName.get(adjName);
        if (to && from !== to) {
          await store.addAdjacency(from, to, 1, true);
        }
      }
    }

    // Characters
    for (const charSpec of compiled.characters) {
      const aid = agentId();
      const startLoc = locationByName.get(charSpec.startingLocationName) ?? null;
      const agent: Agent = {
        id: aid,
        worldId: id,
        name: charSpec.name,
        persona: charSpec.persona,
        traits: charSpec.traits,
        privateState: charSpec.privateState ?? null,
        alive: true,
        locationId: startLoc,
        mood: charSpec.startingMood ?? null,
        energy: 100,
        health: 100,
        tokensBudget: null,
        tokensSpent: 0,
        sessionId: null,
        sessionStateBlob: null,
        modelTier: 'haiku',
        provider: opts.defaultProvider,
        modelId: opts.defaultModelId,
        thinkingLevel: 'low',
        birthTick: 0,
        deathTick: null,
        parentIds: null,
        createdAt: new Date().toISOString(),
      };
      await store.createAgent(agent);
    }

    // Resources
    for (const resSpec of compiled.resources) {
      if (resSpec.perAgent) {
        const agents = await store.getLiveAgents(id);
        for (const a of agents) {
          const res: Resource = {
            id: resourceId(),
            worldId: id,
            type: resSpec.type,
            ownerAgentId: a.id,
            ownerLocationId: null,
            quantity: resSpec.initialQuantity,
            metadata: {},
          };
          await store.createResource(res);
        }
      } else if (resSpec.atLocationName) {
        const lid = locationByName.get(resSpec.atLocationName);
        if (lid) {
          const res: Resource = {
            id: resourceId(),
            worldId: id,
            type: resSpec.type,
            ownerAgentId: null,
            ownerLocationId: lid,
            quantity: resSpec.initialQuantity,
            metadata: {},
          };
          await store.createResource(res);
        }
      }
    }

    // Actions
    for (const actSpec of compiled.actions) {
      const action: ActionSchema = {
        id: actionId(),
        worldId: id,
        name: actSpec.name,
        description: actSpec.description,
        parametersSchema: actSpec.parameters,
        baseCost: actSpec.baseCost,
        requiresTargetType: 'none',
        visibility: actSpec.visibility,
        effects: {},
        enforcementRef: null,
        active: true,
      };
      await store.createActionSchema(action);
    }

    // Rules (compiled via RuleCompiler)
    const rules = await this.ruleCompiler.compile(id, compiled.rules);
    for (const rule of rules) {
      await store.createRule(rule);
    }

    // Initial scene as the first event
    await store.recordEvent({
      worldId: id,
      tick: 0,
      eventType: 'tick_begin',
      actorId: null,
      data: { initialScene: compiled.initialScene },
      tokenCost: 0,
    });

    return id;
  }
}

function buildWorldCompilerSystemPrompt(): string {
  return `You are a world designer for a simulation platform called Chronicle.

You receive a user's natural-language description of a scenario and compile it into a complete structured world.

Your output is JSON with this shape:
{
  "name": "short name for the world",
  "atmosphere": "tense/hopeful/chaotic/... (one word)",
  "atmosphereTag": "parlor_drama / survival_thriller / tech_workplace / teen_drama / medieval_court / ...",
  "scale": "small" | "medium" | "large",
  "tickDurationDescription": "e.g., '1 hour in-world'",
  "dayNightCycleTicks": integer or null,

  "sharedSystemPrompt": "the system prompt every character sees describing the world they live in",

  "characters": [
    { name, age?, persona (full paragraph), shortDescription, traits {...}, privateState? {...}, startingMood?, startingLocationName }
  ],

  "locations": [
    { name, description, spriteHint?, affordances [...], adjacentTo [other location names] }
  ],

  "resources": [
    { type, initialQuantity, atLocationName? OR perAgent: true }
  ],

  "rules": [natural language strings — each rule will be compiled separately],

  "actions": [
    { name, description, parameters {...}, baseCost {...}, visibility, availableTo? }
  ],

  "initialScene": "300-word-max narrative description of the opening moment"
}

PRINCIPLES:
- Every character MUST have at least one interesting private state (secret/tension/fear/goal).
- Characters should be diverse — different roles, ages, motivations.
- Include at least 3 tension sources: scarcity, asymmetric info, conflicting goals, power imbalance, time pressure, or moral ambiguity.
- Always include core actions: observe, speak, think, move. Add world-specific ones.
- Rules should be mixed tiers (some hard physical constraints, some social norms, some economic costs).
- Keep scale realistic: small=3-8 chars, medium=8-15, large=15-30.

Return ONLY the JSON. No prose.`;
}
