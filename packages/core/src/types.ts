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
  /**
   * Activation-filter knobs (ADR-0010). Optional — defaults applied
   * by ActivationService when absent, so older worlds keep working.
   */
  activation?: ActivationConfig;
}

export interface ActivationConfig {
  /**
   * Max ticks an agent may stay silent before the engine forces a
   * turn. Default 5. `Infinity` = reactive-only (never force).
   */
  idleTimeout: number;
  /**
   * How far back the filter scans for witnessed events. Default 2.
   * Keep small — larger windows inflate per-tick DB work.
   */
  lookbackTicks: number;
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
  /**
   * Tick on which this agent most recently took a turn (action, pass,
   * or any other tool call). `null` before the first turn. Used by
   * ActivationService to enforce the idle timeout signal.
   *
   * Declared optional for backwards compatibility — fixtures and older
   * DB rows may not carry it. Treat missing / undefined as "never
   * acted" (same as `null`).
   */
  lastActiveTick?: number | null;
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
  /**
   * Primary scope — which entity category owns this rule. A
   * `scopeKind='group'` rule only binds actions taken by members of
   * `scopeRef` (a groupId). `scopeKind='world'` (default) means
   * worldwide. See ADR-0009 § Authority primitives.
   *
   * Declared optional for backwards compatibility with rules authored
   * before the governance layer. Missing / undefined is treated as
   * `'world'` by both the store and the enforcer.
   */
  scopeKind?: RuleScopeKind;
  /** `null` when scopeKind='world'; otherwise id of the owning entity. */
  scopeRef?: string | null;
  /** Fine-grained filter on top of the primary scope. Legacy; still useful. */
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
  | 'catalyst'
  // governance (ADR-0009 Layer 2)
  | 'proposal_opened'
  | 'proposal_adopted'
  | 'proposal_rejected'
  | 'proposal_expired'
  | 'proposal_withdrawn'
  | 'vote_cast'
  // activation (ADR-0010)
  | 'agent_dormant'
  // Active agent took a turn but produced no tool call — distinct
  // from `agent_dormant` (engine skipped the turn). See engine.ts.
  | 'agent_silent'
  // Run hit the user-specified token budget — persisted so cross-
  // process subscribers (dashboard via DbEventRelay) can surface it
  // instead of silently seeing the world drift to status=paused.
  | 'budget_exceeded';

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
// GOVERNANCE — groups, authorities, and decision procedures
//
// See docs/adr/0009-governance-primitives.md for the full rationale.
// The short version: every political archetype (parliament, tyranny,
// anarchy, feudalism, ...) decomposes into some configuration of
// Group + Authority + Procedure + (in Layer 2) Proposal + Effect.
// The engine knows nothing about "tyranny"; it knows about the
// primitives.
// ============================================================

/** How a group makes decisions. See ADR-0009 § Procedure primitives. */
export type ProcedureKind = 'decree' | 'vote' | 'consensus' | 'lottery' | 'delegated';

/**
 * Succession rule when a role becomes vacant. `null` means the role
 * simply stays vacant until something else fills it (e.g. a proposal).
 */
export type SuccessionKind = 'vote' | 'inheritance' | 'appointment' | 'combat' | 'lottery' | null;

/**
 * How outsiders perceive the group's internal deliberation.
 * - `open`    — non-members see opened, votes, and outcome events
 * - `closed`  — non-members see opened + outcome only; votes hidden
 * - `opaque`  — non-members do not even know the group exists
 */
export type VisibilityPolicy = 'open' | 'closed' | 'opaque';

export interface Group {
  id: string;
  worldId: string;
  name: string;
  description: string;
  procedureKind: ProcedureKind;
  /**
   * Procedure-specific parameters. Shape depends on `procedureKind`:
   * - decree: `{ holderRole: string }`
   * - vote: `{ threshold: number; quorum?: number; weights?: 'equal' | 'role' | 'authority' | 'custom' }`
   * - consensus: `{ vetoCount?: number }` (default 1)
   * - lottery: `{ eligible: 'members' | 'citizens' }`
   * - delegated: `{ toGroupId: string }`
   */
  procedureConfig: Record<string, unknown>;
  /**
   * Optional predicate gating new members. Compiled expression in the
   * same DSL as rules (see ADR-0008). `null` = open (anyone can join
   * pending any authority-gated invitation logic).
   */
  joinPredicate: string | null;
  successionKind: SuccessionKind;
  visibilityPolicy: VisibilityPolicy;
  foundedTick: number;
  /** `null` while the group is still active. */
  dissolvedTick: number | null;
  createdAt: string;
}

export interface GroupMembership {
  groupId: string;
  agentId: string;
  joinedTick: number;
  /** `null` while still a member. Historical rows remain for audit. */
  leftTick: number | null;
}

export interface GroupRole {
  groupId: string;
  roleName: string;
  /** `null` when the seat is vacant. */
  holderAgentId: string | null;
  assignedTick: number | null;
  /** Used when the group's vote procedure has `weights: 'role'`. */
  votingWeight: number;
  /** Optional extra scope this role carries beyond the group's base scope. */
  scopeRef: string | null;
}

/**
 * Who can hold an authority.
 * - `group`: a whole group holds it (group members can invoke it
 *   subject to the group's procedure)
 * - `agent`: a specific character holds it personally
 * - `role`: the holder is whichever agent currently sits in a named
 *   role of a group (holderRef is `${groupId}#${roleName}`)
 */
export type AuthorityHolderKind = 'group' | 'agent' | 'role';

/**
 * Things an authority can do. Stored as JSON in `authorities.powers_json`.
 * Extensible — new power kinds are added over time as the Effect catalog
 * grows.
 */
export type AuthorityPower =
  /** Can override a specific rule — actions violating it are let through. */
  | { kind: 'override_rule'; ruleId: string }
  /** Can sponsor proposals that carry these effect types. `['*']` = any. */
  | { kind: 'propose'; effectTypes: string[] }
  /** Can directly execute an effect without a proposal (for decree groups). */
  | { kind: 'execute_effect'; effectType: string; scope?: string }
  /** Can grant authorities down to others (bounded by maxScope). */
  | { kind: 'grant_authority'; maxScope?: string }
  /**
   * Sentinel marker. An authority carrying this power cannot be
   * revoked by any proposal or god intervention — the engine refuses
   * `revoke_authority` on it. Used for L0 seeded authorities that
   * protect runtime integrity. Stack with other powers freely.
   */
  | { kind: 'inviolable' };

export interface Authority {
  id: string;
  worldId: string;
  holderKind: AuthorityHolderKind;
  /**
   * - when holderKind='group': groupId
   * - when holderKind='agent': agentId
   * - when holderKind='role':  `${groupId}#${roleName}`
   */
  holderRef: string;
  powers: AuthorityPower[];
  grantedTick: number;
  /** `null` = indefinite. Term limits / regencies set this. */
  expiresTick: number | null;
  /** Event id that produced this grant (for audit / replay). */
  sourceEventId: number | null;
  /** `null` while active; a tick value marks retraction. */
  revokedTick: number | null;
  revocationEventId: number | null;
}

/**
 * A rule's scope controls whom it binds. World-wide is the legacy
 * default. Group/agent/location scoped rules only evaluate when the
 * actor is within that scope (see RuleEnforcer).
 */
export type RuleScopeKind = 'world' | 'group' | 'agent' | 'location';

// ============================================================
// PROPOSAL / VOTE / EFFECT  (ADR-0009 Layer 2)
//
// A Proposal is a pending state-change: sponsor + target group +
// effect payload + deadline. The group's decision procedure (see
// Group.procedureKind) decides adoption. Adopted proposals execute
// their effects through the shared EffectRegistry — the same
// registry GodService uses, so a god intervention is literally a
// proposal that auto-adopts.
// ============================================================

export type ProposalStatus = 'pending' | 'adopted' | 'rejected' | 'withdrawn' | 'expired';

export type VoteStance = 'for' | 'against' | 'abstain';

/**
 * When a proposal is settled. Polymorphic — a procedure may prefer a
 * hard tick limit, a quorum trigger, or "close when every eligible
 * member has voted."
 */
export type ProposalDeadline =
  | { kind: 'tick'; at: number }
  | { kind: 'quorum'; need: number }
  | { kind: 'all_voted' }
  | { kind: 'any_of'; options: ProposalDeadline[] };

export interface Proposal {
  id: string;
  worldId: string;
  sponsorAgentId: string;
  targetGroupId: string;
  title: string;
  rationale: string;
  /** Raw, pre-validation effects as authored by the sponsor. */
  effects: Effect[];
  /**
   * Validator output — either the same array with extra metadata or
   * `null` if validation hasn't run yet. EffectRegistry.validate fills
   * this in when the proposal is created.
   */
  compiledEffects: Effect[] | null;
  openedTick: number;
  deadline: ProposalDeadline;
  /** Procedure override if set; otherwise use targetGroup.procedureKind. */
  procedureOverride: Record<string, unknown> | null;
  status: ProposalStatus;
  decidedTick: number | null;
  outcomeDetail: string | null;
}

export interface Vote {
  proposalId: string;
  voterAgentId: string;
  stance: VoteStance;
  /** Procedure-specific; 1.0 for equal weighting. */
  weight: number;
  castTick: number;
  /** Optional rationale the voter wants on the record. */
  reasoning: string | null;
}

/**
 * An Effect is a typed instruction that mutates world state. Each kind
 * has a dedicated handler in EffectRegistry. Every effect is idempotent
 * at the semantic level — running it twice with the same inputs should
 * be a no-op or produce the same final state, to keep replay sane.
 *
 * The catalog below is the Layer-2 minimum viable set. Layer 3 will
 * grow it (claim_location, declare_relation, etc.).
 */
export type Effect =
  // --- entity lifecycle ---
  | {
      kind: 'create_location';
      name: string;
      description: string;
      adjacentTo?: string[]; // location names that already exist
      spriteHint?: string;
    }
  | {
      kind: 'create_group';
      name: string;
      description: string;
      procedure: ProcedureKind;
      procedureConfig?: Record<string, unknown>;
      visibility?: VisibilityPolicy;
      initialMembers?: string[] /* agentIds */;
    }
  | { kind: 'dissolve_group'; groupId: string }
  | {
      kind: 'create_rule';
      description: string;
      tier: 'hard' | 'soft' | 'economic';
      predicate?: string;
      check?: string;
      onViolation?: string;
      softNormText?: string;
      economicActionType?: string;
      economicCostFormula?: string;
      scopeKind?: RuleScopeKind;
      scopeRef?: string | null;
    }
  | { kind: 'repeal_rule'; ruleId: string }
  // --- membership & role ---
  | { kind: 'add_member'; groupId: string; agentId: string }
  | { kind: 'remove_member'; groupId: string; agentId: string }
  | {
      kind: 'assign_role';
      groupId: string;
      roleName: string;
      agentId: string;
      votingWeight?: number;
      scopeRef?: string | null;
    }
  | { kind: 'vacate_role'; groupId: string; roleName: string }
  // --- authority ---
  | {
      kind: 'grant_authority';
      holderKind: AuthorityHolderKind;
      holderRef: string;
      powers: AuthorityPower[];
      expiresTick?: number | null;
    }
  | { kind: 'revoke_authority'; authorityId: string }
  // --- structural change ---
  | {
      kind: 'change_procedure';
      groupId: string;
      newProcedure: ProcedureKind;
      newConfig?: Record<string, unknown>;
    }
  // --- resources ---
  | {
      kind: 'transfer_resource';
      resourceId: string;
      toOwnerKind: 'agent' | 'location';
      toOwnerRef: string;
      quantity: number;
    }
  // --- agent mutation (ADR-0011) ---
  | {
      kind: 'update_agent';
      agentId: string;
      /**
       * Overwrite persona if present. Omit to keep. Persona is
       * non-nullable on the Agent type, so this field has no
       * "clear" semantic — pass a replacement string.
       */
      persona?: string;
      /** `null` clears mood; omit to keep. */
      mood?: string | null;
      /** `null` clears privateState; omit to keep. */
      privateState?: Record<string, unknown> | null;
      /** Omit to keep. Partial merge is NOT supported — replaces entirely. */
      traits?: Record<string, number | string | boolean>;
    };

export type EffectKind = Effect['kind'];

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
