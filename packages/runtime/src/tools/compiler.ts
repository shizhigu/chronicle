/**
 * Tool compiler — generates pi-agent tools from world ActionSchemas.
 *
 * Each world has an action_schemas table. We turn each row into a Tool
 * the agent can call. Execution mutates the DB via WorldStore.
 *
 * ## Memory tools
 *
 * The agent curates its own memory through three tools — `memory_add`,
 * `memory_replace`, `memory_remove` — backed by a plain markdown file
 * per character (hermes-agent pattern). There is intentionally no
 * `memory_read` or `recall` tool: the full memory file is embedded in
 * the system prompt at session start as a frozen snapshot, so reading
 * is free and prefix-cacheable. No embeddings, no keyword scoring —
 * the agent's own compression of what matters is the authority.
 */

import type {
  ActionSchema,
  Agent,
  Effect,
  Group,
  Proposal,
  ProposalDeadline,
  VoteStance,
  World,
} from '@chronicle/core';
import { groupId as newGroupId, proposalId as newProposalId } from '@chronicle/core';
import type { MemoryFileStore, WorldStore } from '@chronicle/engine';
import { validateEffects } from '@chronicle/engine';
import { z } from 'zod';

// Pi-agent Tool interface (inlined to avoid tight coupling if API shifts).
export interface AgentTool<T = unknown> {
  name: string;
  description: string;
  parametersSchema: z.ZodSchema<T>;
  execute: (args: T, context: ExecutionContext) => Promise<ExecuteResult>;
}

export interface ExecutionContext {
  world: World;
  character: Agent;
  tick: number;
  store: WorldStore;
  /**
   * File-backed memory for the character. Always present — core memory
   * tools would be useless without it, so callers build one up-front.
   */
  memory: MemoryFileStore;
}

export interface ExecuteResult {
  ok: boolean;
  detail?: string;
  sideEffects?: Record<string, unknown>;
}

// Heterogeneous tool collection: each tool has its own arg schema, so we
// accept the family as a wildcard at the collection level.
export type AnyAgentTool = AgentTool<any>;

/** Action tool names reserved by core tools — world schemas can't shadow these. */
const CORE_TOOL_NAMES = new Set([
  'observe',
  'think',
  'speak',
  'memory_add',
  'memory_replace',
  'memory_remove',
  'form_group',
  'join_group',
  'leave_group',
  'propose',
  'vote',
  'withdraw_proposal',
  'pass',
]);

export function compileWorldTools(
  _world: World,
  _character: Agent,
  store: WorldStore,
  schemas: ActionSchema[],
): AnyAgentTool[] {
  // Always register core tools. The `memory_*` trio is the character's
  // only durable memory surface — everything the agent wants future
  // selves to see must be committed via memory_add. The `*_group` trio
  // is the minimum viable governance surface (ADR-0009 Layer 1) —
  // collective identity. Proposals + votes + effects come in Layer 2.
  const tools: AnyAgentTool[] = [
    coreObserve(),
    coreThink(),
    coreSpeak(),
    corePass(),
    coreMemoryAdd(),
    coreMemoryReplace(),
    coreMemoryRemove(),
    coreFormGroup(),
    coreJoinGroup(),
    coreLeaveGroup(),
    corePropose(),
    coreVote(),
    coreWithdrawProposal(),
  ];

  // Plus schema-driven world-specific tools
  for (const schema of schemas) {
    if (!schema.active) continue;
    if (CORE_TOOL_NAMES.has(schema.name)) continue; // core wins
    tools.push(compileSchemaAsTool(schema, store));
  }

  return tools;
}

// ============================================================
// Core tools (available in every world)
// ============================================================

function coreObserve(): AgentTool<Record<string, never>> {
  return {
    name: 'observe',
    description:
      'Return your current observation — what you see, hear, feel. Costs almost nothing.',
    parametersSchema: z.object({}).strict(),
    execute: async () => ({ ok: true, detail: 'observation_refreshed' }),
  };
}

/**
 * Internal monologue. The thought lives in the agent's pi-agent
 * conversation history (so it influences the next turn) but is NOT
 * committed to the durable memory file — that's what `memory_add` is
 * for. This keeps the memory file a short, agent-curated summary
 * rather than a dumping ground for every stray thought.
 */
function coreThink(): AgentTool<{ thought: string }> {
  return {
    name: 'think',
    description:
      'Private inner monologue, heard by no one. Appears in your own conversation history so you carry it into the next moment, but is NOT durably saved. If a thought should outlive this turn, call memory_add after.',
    parametersSchema: z.object({
      thought: z.string().min(1).max(2000),
    }),
    execute: async () => ({ ok: true, detail: 'thought_noted' }),
  };
}

/**
 * Deliberate non-action (ADR-0010). The agent was given the floor, saw
 * the turn prompt, and chose to stay silent. This costs a turn — LLM
 * was prompted — but the mechanical outcome is "nothing happened." The
 * dormancy clock resets because the agent *did* take the floor.
 *
 * Distinct from engine-initiated dormancy: that one skips takeTurn
 * entirely and saves the LLM call. `pass` is the agent's way of
 * saying "present, listening, declining to contribute" —
 * narratively different from being asleep.
 */
function corePass(): AgentTool<{ reason?: string }> {
  return {
    name: 'pass',
    description:
      "Decline to act this turn while remaining present. Use when you're listening / observing and genuinely have nothing worth saying right now. This is not the same as being absent — you saw what's happening and chose to stay quiet. Optional `reason` is recorded for the log.",
    parametersSchema: z.object({
      reason: z.string().max(500).optional(),
    }),
    execute: async () => {
      // The engine's standard action-event path records this turn via
      // `extractPrimaryToolCall` → `recordEvent('action', …)`. We used
      // to self-record here too because the adapter's action-extraction
      // was broken (it only scanned the last assistant message); that
      // path now works, so writing the same event twice produces a
      // duplicate pass row per tick. The caller's `reason` travels
      // through the engine's recorded args — no need to echo it into
      // the detail string.
      return { ok: true, detail: 'passed' };
    },
  };
}

function coreSpeak(): AgentTool<{ to: string; content: string; tone?: string }> {
  return {
    name: 'speak',
    description:
      'Say something. "to" can be a character name, "all" for everyone at your location, or "whisper:<name>" for private.',
    parametersSchema: z.object({
      to: z.string(),
      content: z.string().min(1).max(2000),
      tone: z.enum(['neutral', 'angry', 'whispered', 'shouted', 'sarcastic']).optional(),
    }),
    execute: async ({ to, content, tone }, ctx) => {
      const toAgentId = to.startsWith('whisper:')
        ? await resolveAgentByName(ctx, to.slice('whisper:'.length))
        : to === 'all'
          ? null
          : await resolveAgentByName(ctx, to);

      const isPrivate = to.startsWith('whisper:');
      const heardBy = await computeAudience(ctx, toAgentId, isPrivate);

      await ctx.store.recordMessage({
        worldId: ctx.world.id,
        tick: ctx.tick,
        fromAgentId: ctx.character.id,
        toAgentId,
        toLocationId: !toAgentId && !isPrivate ? ctx.character.locationId : null,
        toChannel: null,
        content,
        tone: tone ?? null,
        private: isPrivate,
        heardBy,
      });
      return { ok: true, detail: `heard_by:${heardBy.length}` };
    },
  };
}

/**
 * Commit an entry to the character's durable memory file. The file
 * contents are injected into the system prompt at the START of each
 * session — so what you add here shapes every future turn. Use it
 * sparingly: promises, betrayals, settled goals, beliefs about others.
 * Ephemeral reactions belong in `think`, not here.
 *
 * Rejects when the file would exceed its char limit. The agent must
 * `memory_replace` or `memory_remove` to free room — this pressure is
 * what forces the agent to compress, which is the entire point of the
 * design. No retrieval, no scoring: the file IS the working set.
 */
function coreMemoryAdd(): AgentTool<{ content: string }> {
  return {
    name: 'memory_add',
    description:
      'Append an entry to your durable memory file. This memory will appear in your context at the start of every future session. Keep entries short and specific — promises, betrayals, settled goals, beliefs about others. If the file is full, use memory_replace or memory_remove first.',
    parametersSchema: z.object({
      content: z.string().min(1).max(2000),
    }),
    execute: async ({ content }, ctx) => {
      return ctx.memory.add(ctx.world.id, ctx.character.id, content);
    },
  };
}

/**
 * Replace an entry in the memory file. `old_text` is a short unique
 * substring that picks out one entry; we rewrite that entry to
 * `new_content`. Ambiguous matches (0 or >1 entries) fail hard — the
 * agent must re-narrow rather than silently editing the wrong thing.
 */
function coreMemoryReplace(): AgentTool<{ old_text: string; new_content: string }> {
  return {
    name: 'memory_replace',
    description:
      'Rewrite one entry in your memory file. old_text is a short unique substring that picks out which entry to edit. Use this to compress older entries as beliefs evolve or the file fills up.',
    parametersSchema: z.object({
      old_text: z.string().min(1).max(500),
      new_content: z.string().min(1).max(2000),
    }),
    execute: async ({ old_text, new_content }, ctx) => {
      return ctx.memory.replace(ctx.world.id, ctx.character.id, old_text, new_content);
    },
  };
}

/** Delete an entry. Same uniqueness rules as `memory_replace`. */
function coreMemoryRemove(): AgentTool<{ old_text: string }> {
  return {
    name: 'memory_remove',
    description:
      'Delete one entry from your memory file. old_text is a short unique substring that picks out which entry to remove. Use this when a memory is outdated or no longer serves you.',
    parametersSchema: z.object({
      old_text: z.string().min(1).max(500),
    }),
    execute: async ({ old_text }, ctx) => {
      return ctx.memory.remove(ctx.world.id, ctx.character.id, old_text);
    },
  };
}

// ============================================================
// Governance tools (ADR-0009 Layer 1)
//
// These three let agents form collective identity at runtime. Layer 2
// (proposals + votes + effects) will make those collectives causally
// powerful — for now they're named groupings with procedure metadata
// that scoped rules and future proposals will target.
// ============================================================

/**
 * Found a new group. Caller becomes founding member and, for `decree`
 * procedure, automatically takes the configured `holderRole`. Group
 * names are unique within a world; duplicates fail rather than silently
 * aliasing.
 */
function coreFormGroup(): AgentTool<{
  name: string;
  description: string;
  procedure: 'decree' | 'vote' | 'consensus' | 'lottery' | 'delegated';
  procedure_config?: Record<string, unknown>;
  visibility?: 'open' | 'closed' | 'opaque';
}> {
  return {
    name: 'form_group',
    description:
      'Found a new group — a council, faction, guild, conspiracy, whatever. You become the founding member. Pick a decision procedure: "decree" (one voice decides — tyranny or chair-led council), "vote" (majority), "consensus" (any dissent blocks), "lottery" (random member decides), or "delegated" (this group defers to another group\'s decision — used for federations / alliances; procedure_config must carry toGroupId).',
    parametersSchema: z.object({
      name: z.string().min(1).max(80),
      description: z.string().min(1).max(500),
      procedure: z.enum(['decree', 'vote', 'consensus', 'lottery', 'delegated']),
      procedure_config: z.record(z.unknown()).optional(),
      visibility: z.enum(['open', 'closed', 'opaque']).optional(),
    }),
    execute: async ({ name, description, procedure, procedure_config, visibility }, ctx) => {
      const existing = await ctx.store.getGroupsForWorld(ctx.world.id);
      if (existing.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
        return { ok: false, detail: `duplicate_group_name:${name}` };
      }

      // `delegated` groups must name the group they defer to, and that
      // group must live in this world. Without this guard a delegation
      // cycle or cross-world reference would blow up at Layer-2 resolve.
      if (procedure === 'delegated') {
        const toGroupId = (procedure_config?.toGroupId as string | undefined)?.trim();
        if (!toGroupId) {
          return { ok: false, detail: 'delegated_requires_toGroupId' };
        }
        const target = await ctx.store.getGroup(toGroupId);
        if (!target || target.worldId !== ctx.world.id) {
          return { ok: false, detail: `no_target_group:${toGroupId}` };
        }
      }

      const group: Group = {
        id: newGroupId(),
        worldId: ctx.world.id,
        name,
        description,
        procedureKind: procedure,
        procedureConfig: procedure_config ?? defaultProcedureConfig(procedure),
        joinPredicate: null,
        successionKind: null,
        visibilityPolicy: visibility ?? 'open',
        foundedTick: ctx.tick,
        dissolvedTick: null,
        createdAt: new Date().toISOString(),
      };
      await ctx.store.createGroup(group);
      await ctx.store.addMembership(group.id, ctx.character.id, ctx.tick);

      // For decree procedures, the founder occupies the chair role so
      // the group's "one voice" has someone actually filling it.
      if (procedure === 'decree') {
        const roleName = (procedure_config?.holderRole as string | undefined)?.trim() || 'chair';
        await ctx.store.upsertGroupRole({
          groupId: group.id,
          roleName,
          holderAgentId: ctx.character.id,
          assignedTick: ctx.tick,
          votingWeight: 1.0,
          scopeRef: null,
        });
      }

      return {
        ok: true,
        detail: `group_formed:${group.id}`,
        sideEffects: { groupId: group.id, name: group.name, procedure },
      };
    },
  };
}

/**
 * Request membership in an existing group. Fails if already a member,
 * if the group has a join predicate the caller doesn't satisfy, or if
 * the group doesn't exist / is dissolved. (Predicate evaluation and
 * invitation-gating are Layer 2; Layer 1 honors only predicate=null.)
 */
function coreJoinGroup(): AgentTool<{ group_id: string }> {
  return {
    name: 'join_group',
    description:
      'Join an existing group by id. Fails if the group is gated (requires an invitation or predicate you do not satisfy) or if you are already a member.',
    parametersSchema: z.object({
      group_id: z.string().min(1),
    }),
    execute: async ({ group_id }, ctx) => {
      const group = await ctx.store.getGroup(group_id);
      if (!group) return { ok: false, detail: `no_group:${group_id}` };
      if (group.dissolvedTick !== null) return { ok: false, detail: 'group_dissolved' };
      if (group.worldId !== ctx.world.id) return { ok: false, detail: 'cross_world_group' };

      if (await ctx.store.isMember(group.id, ctx.character.id)) {
        return { ok: false, detail: 'already_member' };
      }

      // Gated groups require Layer-2 invitation / predicate evaluation.
      // In Layer 1 we simply refuse; a scenario author can still seed
      // members directly via the world-compiler / store.
      if (group.joinPredicate !== null) {
        return { ok: false, detail: 'gated_group_requires_invitation' };
      }

      try {
        await ctx.store.addMembership(group.id, ctx.character.id, ctx.tick);
      } catch (err) {
        // Another concurrent join_group won the race — the unique index
        // on (group_id, agent_id) WHERE left_tick IS NULL caught it.
        // Surface the same detail string a same-turn duplicate would see.
        if (err instanceof Error && err.name === 'AlreadyMemberError') {
          return { ok: false, detail: 'already_member' };
        }
        throw err;
      }
      return { ok: true, detail: `joined:${group.id}` };
    },
  };
}

/**
 * Leave a group the caller belongs to. Vacates any role the caller
 * currently holds in that group (successor logic is Layer 2).
 */
function coreLeaveGroup(): AgentTool<{ group_id: string }> {
  return {
    name: 'leave_group',
    description:
      'Resign from a group. Any role you held in the group is vacated (successor is decided by the group on its own schedule).',
    parametersSchema: z.object({
      group_id: z.string().min(1),
    }),
    execute: async ({ group_id }, ctx) => {
      const group = await ctx.store.getGroup(group_id);
      if (!group) return { ok: false, detail: `no_group:${group_id}` };
      if (!(await ctx.store.isMember(group.id, ctx.character.id))) {
        return { ok: false, detail: 'not_a_member' };
      }

      await ctx.store.removeMembership(group.id, ctx.character.id, ctx.tick);

      // Vacate any role this agent held in this group.
      const roles = await ctx.store.getRolesForGroup(group.id);
      for (const role of roles) {
        if (role.holderAgentId === ctx.character.id) {
          await ctx.store.upsertGroupRole({
            groupId: group.id,
            roleName: role.roleName,
            holderAgentId: null,
            assignedTick: ctx.tick,
            votingWeight: role.votingWeight,
            scopeRef: role.scopeRef,
          });
        }
      }

      return { ok: true, detail: `left:${group.id}` };
    },
  };
}

// ============================================================
// Proposal tools (ADR-0009 Layer 2)
// ============================================================

// JSON schema describing an Effect. We accept a narrow subset at the
// tool boundary — full structural validation happens in
// `validateEffects` once the proposal hits the store. Keeping the Zod
// schema shallow lets the tool surface stay readable for the LLM.
// The double-cast via `unknown` is required because the permissive
// passthrough schema doesn't structurally match the discriminated
// union — the strict validation lives downstream in EffectRegistry.
const EffectSchema = z
  .object({
    kind: z.string(),
  })
  .passthrough() as unknown as z.ZodType<Effect>;

const DeadlineSchema: z.ZodType<ProposalDeadline> = z.union([
  z.object({ kind: z.literal('tick'), at: z.number().int().positive() }),
  z.object({ kind: z.literal('quorum'), need: z.number().int().positive() }),
  z.object({ kind: z.literal('all_voted') }),
  z.object({
    kind: z.literal('any_of'),
    options: z.array(z.lazy(() => DeadlineSchema)),
  }),
]);

/**
 * Submit a motion to a group the caller belongs to. The motion carries
 * a structured effect payload — what would change if it passed. Effects
 * are validated up-front through EffectRegistry; a malformed proposal
 * is rejected before any votes can be gathered, so voters never reason
 * about an impossible outcome.
 */
function corePropose(): AgentTool<{
  target_group_id: string;
  title: string;
  rationale: string;
  effects: Effect[];
  deadline?: ProposalDeadline;
}> {
  return {
    name: 'propose',
    description:
      'Submit a motion to a group you belong to. Include a clear title, a rationale (your case for why the group should adopt this), and an effects list — the structured state changes that will apply IF the proposal is adopted. Use short, specific effects. Deadline defaults to 10 ticks from now.',
    parametersSchema: z.object({
      target_group_id: z.string().min(1),
      title: z.string().min(1).max(200),
      rationale: z.string().min(1).max(2000),
      effects: z.array(EffectSchema).min(1).max(10),
      deadline: DeadlineSchema.optional(),
    }),
    execute: async ({ target_group_id, title, rationale, effects, deadline }, ctx) => {
      const group = await ctx.store.getGroup(target_group_id);
      if (!group || group.worldId !== ctx.world.id) {
        return { ok: false, detail: `no_group:${target_group_id}` };
      }
      if (group.dissolvedTick !== null) return { ok: false, detail: 'group_dissolved' };

      // Only members may propose by default. Authority-gated proposal
      // rights (e.g. "only nobles may legislate") live in scoped rules;
      // the Layer-1 authority override path lets them bypass this check
      // through the RuleEnforcer — this tool only enforces the baseline.
      if (!(await ctx.store.isMember(group.id, ctx.character.id))) {
        return { ok: false, detail: 'not_a_member' };
      }

      // Validate effects before persisting. A failing validation returns
      // a crisp reason so the LLM can correct its payload on retry.
      const validation = await validateEffects(effects, {
        store: ctx.store,
        world: ctx.world,
        tick: ctx.tick,
      });
      if (validation) {
        return {
          ok: false,
          detail: `effect_invalid:${validation.index}:${validation.reason}`,
        };
      }

      const proposal: Proposal = {
        id: newProposalId(),
        worldId: ctx.world.id,
        sponsorAgentId: ctx.character.id,
        targetGroupId: group.id,
        title,
        rationale,
        effects,
        // Shallow clone so that future compilation passes (which may
        // normalise or rewrite effects) cannot retroactively mutate the
        // sponsor's original `effects` array via shared reference.
        compiledEffects: [...effects],
        openedTick: ctx.tick,
        deadline: deadline ?? { kind: 'tick', at: ctx.tick + 10 },
        procedureOverride: null,
        status: 'pending',
        decidedTick: null,
        outcomeDetail: null,
      };
      await ctx.store.createProposal(proposal);

      await ctx.store.recordEvent({
        worldId: ctx.world.id,
        tick: ctx.tick,
        eventType: 'proposal_opened',
        actorId: ctx.character.id,
        data: { proposalId: proposal.id, title, targetGroupId: group.id },
        tokenCost: 0,
      });

      return {
        ok: true,
        detail: `proposal_opened:${proposal.id}`,
        sideEffects: { proposalId: proposal.id },
      };
    },
  };
}

/**
 * Cast a vote on a pending proposal in a group the caller belongs to.
 * Recasting is allowed — politics is fluid — but each voter only ever
 * has one active vote per proposal. `weight` comes from the group's
 * procedure config (equal vs role-weighted); the tool does NOT accept
 * a caller-supplied weight to prevent agents from self-declaring
 * larger influence than their role confers.
 */
function coreVote(): AgentTool<{
  proposal_id: string;
  stance: VoteStance;
  reasoning?: string;
}> {
  return {
    name: 'vote',
    description:
      'Vote on a pending proposal in a group you belong to. Stance: "for" / "against" / "abstain". Attach a short reasoning so your position is on the record. Re-voting overrides your previous stance.',
    parametersSchema: z.object({
      proposal_id: z.string().min(1),
      stance: z.enum(['for', 'against', 'abstain']),
      reasoning: z.string().max(1000).optional(),
    }),
    execute: async ({ proposal_id, stance, reasoning }, ctx) => {
      const prop = await ctx.store.getProposal(proposal_id);
      if (!prop || prop.worldId !== ctx.world.id) {
        return { ok: false, detail: `no_proposal:${proposal_id}` };
      }
      if (prop.status !== 'pending') {
        return { ok: false, detail: `proposal_${prop.status}` };
      }
      if (!(await ctx.store.isMember(prop.targetGroupId, ctx.character.id))) {
        return { ok: false, detail: 'not_eligible' };
      }

      // Role-weight: pick up the voter's weight from a role they hold
      // in the target group, if any. Default 1.0 otherwise. (Group-level
      // `weights: "equal"` implicitly defaults here too — equal = 1.0 for
      // everyone.)
      const roles = await ctx.store.getRolesForGroup(prop.targetGroupId);
      const voterRole = roles.find((r) => r.holderAgentId === ctx.character.id);
      const weight = voterRole?.votingWeight ?? 1.0;

      await ctx.store.castVote({
        proposalId: prop.id,
        voterAgentId: ctx.character.id,
        stance,
        weight,
        castTick: ctx.tick,
        reasoning: reasoning ?? null,
      });

      await ctx.store.recordEvent({
        worldId: ctx.world.id,
        tick: ctx.tick,
        eventType: 'vote_cast',
        actorId: ctx.character.id,
        data: { proposalId: prop.id, stance, weight },
        tokenCost: 0,
      });

      return { ok: true, detail: `voted:${stance}:weight=${weight}` };
    },
  };
}

/**
 * The sponsor may withdraw their own pending proposal. Nobody else
 * can withdraw it — that would be a censorship move, and if a group
 * wants to kill a proposal from outside it should use the regular
 * vote mechanism.
 */
function coreWithdrawProposal(): AgentTool<{ proposal_id: string }> {
  return {
    name: 'withdraw_proposal',
    description:
      'Withdraw a pending proposal you sponsored. Only the sponsor can do this; already-decided proposals cannot be withdrawn.',
    parametersSchema: z.object({
      proposal_id: z.string().min(1),
    }),
    execute: async ({ proposal_id }, ctx) => {
      const prop = await ctx.store.getProposal(proposal_id);
      if (!prop || prop.worldId !== ctx.world.id) {
        return { ok: false, detail: `no_proposal:${proposal_id}` };
      }
      if (prop.sponsorAgentId !== ctx.character.id) {
        return { ok: false, detail: 'not_sponsor' };
      }
      if (prop.status !== 'pending') {
        return { ok: false, detail: `proposal_${prop.status}` };
      }
      await ctx.store.updateProposalStatus(prop.id, 'withdrawn', ctx.tick, 'sponsor_withdrew');
      await ctx.store.recordEvent({
        worldId: ctx.world.id,
        tick: ctx.tick,
        eventType: 'proposal_withdrawn',
        actorId: ctx.character.id,
        data: { proposalId: prop.id, title: prop.title },
        tokenCost: 0,
      });
      return { ok: true, detail: `withdrawn:${prop.id}` };
    },
  };
}

/**
 * Defaults that match the hermes "fewest footguns" principle: unless
 * the caller specifies otherwise, a group's procedure should be safe
 * and obvious.
 */
function defaultProcedureConfig(
  kind: 'decree' | 'vote' | 'consensus' | 'lottery' | 'delegated',
): Record<string, unknown> {
  switch (kind) {
    case 'decree':
      return { holderRole: 'chair' };
    case 'vote':
      return { threshold: 0.5, quorum: 0.5, weights: 'equal' };
    case 'consensus':
      return { vetoCount: 1 };
    case 'lottery':
      return { eligible: 'members' };
    case 'delegated':
      // caller MUST supply { toGroupId } in procedure_config; we can't
      // pick a default that makes sense (there's no obvious group to
      // defer to). Leave it empty and let Layer-2 validation catch it.
      return {};
  }
}

async function resolveAgentByName(ctx: ExecutionContext, name: string): Promise<string | null> {
  const agents = await ctx.store.getLiveAgents(ctx.world.id);
  const found = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
  return found?.id ?? null;
}

async function computeAudience(
  ctx: ExecutionContext,
  toAgentId: string | null,
  isPrivate: boolean,
): Promise<string[]> {
  if (isPrivate && toAgentId) return [ctx.character.id, toAgentId];
  if (toAgentId) return [ctx.character.id, toAgentId];
  // Broadcast at location
  const agents = await ctx.store.getLiveAgents(ctx.world.id);
  return agents.filter((a) => a.locationId === ctx.character.locationId).map((a) => a.id);
}

// ============================================================
// Schema-driven world-specific tool compilation
// ============================================================

function compileSchemaAsTool(schema: ActionSchema, _store: WorldStore): AgentTool {
  const zodSchema = zodSchemaFromJson(schema.parametersSchema);

  return {
    name: schema.name,
    description: schema.description,
    parametersSchema: zodSchema,
    execute: async (args, ctx) => {
      // Apply base cost (energy deduction on character)
      const costs = schema.baseCost ?? {};
      if (costs.energy) {
        const newEnergy = Math.max(0, ctx.character.energy - costs.energy);
        await ctx.store.updateAgentState(ctx.character.id, { energy: newEnergy });
        ctx.character.energy = newEnergy;
      }

      // Dispatch by action name
      switch (schema.name) {
        case 'move':
          return executeMove(args as { destination: string }, ctx);
        case 'gather':
          return executeGather(args as { resource: string }, ctx);
        case 'give':
          return executeGive(args as { recipient: string; item: string; quantity: number }, ctx);
        case 'take':
          return executeTake(args as { resource: string; from: string }, ctx);
        case 'sleep':
          return executeSleep(ctx);
        default:
          // Generic: record the attempt, let soft rules / downstream decide
          return { ok: true, detail: `${schema.name}_performed`, sideEffects: { args } };
      }
    },
  };
}

function zodSchemaFromJson(parameters: Record<string, unknown>): z.ZodSchema {
  // Extremely simple translator — supports flat object schemas with {type: "string"|"number"|...}
  const shape: Record<string, z.ZodTypeAny> = {};
  const props = (parameters?.properties ?? parameters) as Record<
    string,
    { type?: string } | undefined
  >;
  for (const [key, spec] of Object.entries(props)) {
    const t = spec?.type ?? 'string';
    switch (t) {
      case 'number':
      case 'integer':
        shape[key] = z.number();
        break;
      case 'boolean':
        shape[key] = z.boolean();
        break;
      default:
        shape[key] = z.string();
    }
  }
  return z.object(shape);
}

// ============================================================
// Builtin action implementations
// ============================================================

async function executeMove(
  args: { destination: string },
  ctx: ExecutionContext,
): Promise<ExecuteResult> {
  const locations = await ctx.store.getLocationsForWorld(ctx.world.id);
  const target = locations.find((l) => l.name.toLowerCase() === args.destination.toLowerCase());
  if (!target) return { ok: false, detail: `no_location:${args.destination}` };

  if (ctx.character.locationId) {
    const adj = await ctx.store.getAdjacentLocations(ctx.character.locationId);
    if (!adj.includes(target.id)) {
      return { ok: false, detail: 'not_adjacent' };
    }
  }

  await ctx.store.updateAgentState(ctx.character.id, { locationId: target.id });
  ctx.character.locationId = target.id;
  return { ok: true, detail: `moved_to:${target.name}` };
}

async function executeGather(
  args: { resource: string },
  ctx: ExecutionContext,
): Promise<ExecuteResult> {
  if (!ctx.character.locationId) return { ok: false, detail: 'no_location' };
  const resources = await ctx.store.getResourcesAtLocation(ctx.character.locationId);
  const resource = resources.find((r) => r.type.toLowerCase() === args.resource.toLowerCase());
  if (!resource || resource.quantity <= 0) return { ok: false, detail: 'not_available' };

  const amount = Math.min(resource.quantity, 1 + Math.random() * 3);
  await ctx.store.adjustResourceQuantity(resource.id, -amount);

  // Add to agent inventory (or create new owned resource)
  const ownedRes = await ctx.store.getResourcesOwnedBy(ctx.character.id);
  const existing = ownedRes.find((r) => r.type === resource.type);
  if (existing) {
    await ctx.store.adjustResourceQuantity(existing.id, amount);
  } else {
    const { resourceId } = await import('@chronicle/core');
    await ctx.store.createResource({
      id: resourceId(),
      worldId: ctx.world.id,
      type: resource.type,
      ownerAgentId: ctx.character.id,
      ownerLocationId: null,
      quantity: amount,
      metadata: {},
    });
  }
  return { ok: true, detail: `gathered:${args.resource}×${amount.toFixed(1)}` };
}

async function executeGive(
  args: { recipient: string; item: string; quantity: number },
  ctx: ExecutionContext,
): Promise<ExecuteResult> {
  const recipientId = await resolveAgentByName(ctx, args.recipient);
  if (!recipientId) return { ok: false, detail: `no_recipient:${args.recipient}` };

  const owned = await ctx.store.getResourcesOwnedBy(ctx.character.id);
  const resource = owned.find((r) => r.type.toLowerCase() === args.item.toLowerCase());
  if (!resource || resource.quantity < args.quantity) {
    return { ok: false, detail: 'insufficient' };
  }

  await ctx.store.adjustResourceQuantity(resource.id, -args.quantity);

  const recipientOwned = await ctx.store.getResourcesOwnedBy(recipientId);
  const existing = recipientOwned.find((r) => r.type === resource.type);
  if (existing) {
    await ctx.store.adjustResourceQuantity(existing.id, args.quantity);
  } else {
    const { resourceId } = await import('@chronicle/core');
    await ctx.store.createResource({
      id: resourceId(),
      worldId: ctx.world.id,
      type: resource.type,
      ownerAgentId: recipientId,
      ownerLocationId: null,
      quantity: args.quantity,
      metadata: {},
    });
  }
  return { ok: true, detail: `gave_${args.item}×${args.quantity}_to:${args.recipient}` };
}

async function executeTake(
  args: { resource: string; from: string },
  ctx: ExecutionContext,
): Promise<ExecuteResult> {
  // "take" without consent — soft rules should flag this
  const targetAgentId = await resolveAgentByName(ctx, args.from);
  if (!targetAgentId) {
    // Maybe "take from location"
    if (!ctx.character.locationId) return { ok: false, detail: 'no_location' };
    return executeGather({ resource: args.resource }, ctx);
  }
  const targetRes = await ctx.store.getResourcesOwnedBy(targetAgentId);
  const resource = targetRes.find((r) => r.type.toLowerCase() === args.resource.toLowerCase());
  if (!resource || resource.quantity <= 0) return { ok: false, detail: 'not_available' };
  const amount = Math.min(resource.quantity, 1);
  await ctx.store.adjustResourceQuantity(resource.id, -amount);
  await ctx.store.transferResource(resource.id, ctx.character.id);
  // Previously self-recorded a duplicate `action` row with
  // `action: 'take_without_consent'` to flag the morality. The
  // engine's extractPrimaryToolCall now records the primary action
  // with the raw `{resource, from}` args — witnesses and rule
  // enforcers can infer the non-consent flavor from `from` pointing
  // at another agent (a consenting transfer uses `give`). Encoding
  // a moral classification as a second duplicate `action` row
  // confuses event-log consumers; a dedicated `moral_violation`
  // event_type is the right home for that if we want it later.
  return { ok: true, detail: `took:${args.resource}:from:${args.from}:amount:${amount}` };
}

async function executeSleep(ctx: ExecutionContext): Promise<ExecuteResult> {
  const newEnergy = Math.min(100, ctx.character.energy + 30);
  await ctx.store.updateAgentState(ctx.character.id, { energy: newEnergy });
  ctx.character.energy = newEnergy;
  return { ok: true, detail: 'rested' };
}
