/**
 * Core type definitions shared across all chronicle packages.
 *
 * These mirror the SQLite schema but typed for TypeScript ergonomics.
 * Nothing here depends on a specific agent runtime or DB implementation.
 */

// ============================================================
// WORLD
// ============================================================

export interface World {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  config: WorldConfig;
  currentTick: number;
  status: 'created' | 'running' | 'paused' | 'ended';
  godBudgetTokens: number | null;
  tokensUsed: number;
  tickDurationDescription: string | null;
  dayNightCycleTicks: number | null;
  createdAt: string;
  createdByChronicle: string | null;
  forkFromTick: number | null;
  rngSeed: number;
}

export interface WorldConfig {
  atmosphere: string; // 'tense' | 'hopeful' | 'chaotic' | ...
  atmosphereTag: string; // for rendering theme selection
  scale: 'small' | 'medium' | 'large';
  mapLayout: MapLayout;
  defaultModelId: string;
  defaultProvider: string;
  reflectionFrequency: number; // every N ticks
  dramaCatalystEnabled: boolean;
}

export type MapLayout =
  | { kind: 'grid'; width: number; height: number }
  | { kind: 'graph'; locations: string[] }
  | { kind: 'abstract' };

// ============================================================
// AGENT
// ============================================================

export type ModelTier = 'haiku' | 'sonnet' | 'opus' | string;
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface Agent {
  id: string;
  worldId: string;
  name: string;
  persona: string;
  traits: Record<string, number | string | boolean>;
  privateState: Record<string, unknown> | null;
  alive: boolean;
  locationId: string | null;
  mood: string | null;
  energy: number;
  health: number;
  tokensBudget: number | null;
  tokensSpent: number;
  sessionId: string | null;
  sessionStateBlob: Uint8Array | null;
  modelTier: ModelTier;
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  birthTick: number;
  deathTick: number | null;
  parentIds: string[] | null;
  createdAt: string;
}

// ============================================================
// LOCATION
// ============================================================

export interface Location {
  id: string;
  worldId: string;
  name: string;
  description: string;
  x: number | null;
  y: number | null;
  parentId: string | null;
  affordances: string[]; // list of action-type names allowed here
  metadata: Record<string, unknown>;
  spriteHint: string | null;
  createdAt: string;
}

// ============================================================
// RESOURCE
// ============================================================

export interface Resource {
  id: string;
  worldId: string;
  type: string;
  ownerAgentId: string | null;
  ownerLocationId: string | null;
  quantity: number;
  metadata: Record<string, unknown>;
}

// ============================================================
// RULE
// ============================================================

export type RuleTier = 'hard' | 'soft' | 'economic';

export interface Rule {
  id: string;
  worldId: string;
  description: string;
  tier: RuleTier;
  // Hard rules
  hardPredicate?: string;
  hardCheck?: string;
  hardOnViolation?: string;
  // Soft rules
  softNormText?: string;
  softDetectionPrompt?: string;
  softConsequence?: string;
  // Economic rules
  economicActionType?: string;
  economicCostFormula?: string;
  // Meta
  active: boolean;
  priority: number;
  scope?: RuleScope;
  createdAt: string;
  createdByTick: number | null;
  compilerNotes: string | null;
}

export interface RuleScope {
  locationIds?: string[];
  agentIds?: string[];
  agentRoles?: string[];
  timeRange?: { fromTick: number; toTick: number };
}

// ============================================================
// ACTION
// ============================================================

export interface ActionSchema {
  id: string;
  worldId: string;
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>; // JSON schema
  baseCost: { energy?: number; tokens?: number; health?: number };
  requiresTargetType: 'none' | 'agent' | 'location' | 'resource' | 'multi';
  visibility: 'public' | 'private' | string; // 'local:5' etc.
  effects: Record<string, unknown>;
  enforcementRef: string | null;
  active: boolean;
}

export interface ProposedAction {
  agentId: string;
  actionName: string;
  args: Record<string, unknown>;
  proposedAt: number;
}

// ============================================================
// EVENT
// ============================================================

export type EventType =
  | 'action'
  | 'tick_begin'
  | 'tick_end'
  | 'god_intervention'
  | 'agent_reflection'
  | 'rule_violation'
  | 'death'
  | 'birth'
  | 'catalyst';

export interface Event {
  id: number;
  worldId: string;
  tick: number;
  wallclockTs: string;
  eventType: EventType;
  actorId: string | null;
  data: Record<string, unknown>;
  visibleTo: string[];
  tokenCost: number;
  dramaScore?: number;
}

// ============================================================
// MESSAGE
// ============================================================

export interface Message {
  id: number;
  worldId: string;
  tick: number;
  fromAgentId: string;
  toAgentId: string | null;
  toLocationId: string | null;
  toChannel: string | null;
  content: string;
  tone: string | null;
  private: boolean;
  heardBy: string[];
}

// ============================================================
// MEMORY
// ============================================================

export type MemoryType = 'observation' | 'reflection' | 'goal' | 'belief_about_other' | 'thought';

export interface AgentMemory {
  id: number;
  agentId: string;
  createdTick: number;
  memoryType: MemoryType;
  content: string;
  importance: number;
  decay: number;
  relatedEventId: number | null;
  aboutAgentId: string | null;
  embedding: Uint8Array | null;
  lastAccessedTick: number | null;
}

// ============================================================
// RELATIONSHIP
// ============================================================

export interface Relationship {
  agentAId: string;
  agentBId: string;
  affection: number;
  trust: number;
  respect: number;
  familiarity: number;
  tags: string[];
  lastInteractionTick: number | null;
}

// ============================================================
// AGREEMENT
// ============================================================

export type AgreementStatus = 'proposed' | 'active' | 'fulfilled' | 'violated' | 'expired';

export interface Agreement {
  id: string;
  worldId: string;
  parties: string[];
  terms: string;
  compiledTerms: Record<string, unknown> | null;
  proposedById: string;
  proposedTick: number;
  acceptedTick: number | null;
  endedTick: number | null;
  status: AgreementStatus;
  violationCount: number;
  enforcementMechanism: 'social' | 'reputation' | 'resource_forfeit' | 'exclusion' | null;
}

// ============================================================
// GOD INTERVENTION
// ============================================================

export interface GodIntervention {
  id: number;
  worldId: string;
  queuedTick: number;
  applyAtTick: number;
  description: string;
  compiledEffects: Record<string, unknown> | null;
  applied: boolean;
  notes: string | null;
}

// ============================================================
// OBSERVATION (built per-agent per-tick)
// ============================================================

export interface Observation {
  agentId: string;
  tick: number;
  selfState: {
    location: string | null;
    mood: string | null;
    energy: number;
    health: number;
    inventory: { type: string; quantity: number }[];
  };
  nearby: {
    agents: { name: string; sprite: string; mood: string | null }[];
    resources: { type: string; quantity: number }[];
    locations: { name: string; adjacent: boolean }[];
  };
  recentEvents: { tick: number; description: string }[];
  relevantMemories: { content: string; importance: number; tick: number }[];
  currentGoals: string[];
}

// ============================================================
// VALIDATION RESULT (rule enforcer)
// ============================================================

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  autoCorrected?: { newArgs: Record<string, unknown>; note: string };
  cost?: { energy?: number; tokens?: number; health?: number };
}

// ============================================================
// TURN RESULT
// ============================================================

export interface TurnResult {
  agentId: string;
  action: ProposedAction | null;
  historyBlob: Uint8Array | null;
  tokensSpent: number;
  error?: string;
  rejectedReason?: string;
}
