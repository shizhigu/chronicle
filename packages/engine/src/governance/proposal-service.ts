/**
 * ProposalService — per-tick lifecycle for pending proposals.
 *
 * Responsibilities:
 *   - Decide whether a pending proposal should close this tick (by
 *     deadline OR by procedure-specific trigger such as quorum).
 *   - Tally votes using the target group's procedure.
 *   - Apply effects via the shared EffectRegistry on adoption.
 *   - Emit `proposal_adopted` / `proposal_rejected` / `proposal_expired`
 *     events so dashboards, memory, and replay all see the settlement.
 *
 * Determinism invariants:
 *   - Lottery uses `seededPick` from `@chronicle/core`'s RNG, fed with
 *     (worldSeed, proposalId, tick) so replay produces the same draw.
 *   - Iteration order over pending proposals is by id lexicographic,
 *     matching WorldStore query order. Two proposals adopted in the
 *     same tick whose effects conflict always apply in that order.
 */

import type { Agent, Effect, Group, Proposal, ProposalStatus, Vote, World } from '@chronicle/core';
import { createRng } from '@chronicle/core';
import type { EventBus } from '../events/bus.js';
import type { WorldStore } from '../store.js';
import { applyEffects } from './effects.js';

export interface ProposalSettleResult {
  proposalId: string;
  status: Exclude<ProposalStatus, 'pending'>;
  detail: string;
  /** Effect outcomes if adopted; empty otherwise. */
  effectResults: { ok: boolean; detail: string }[];
}

export class ProposalService {
  constructor(
    private store: WorldStore,
    private events: EventBus,
  ) {}

  /**
   * Run the per-tick settlement pass. For each pending proposal in
   * `world`, check whether the group's procedure + the proposal's
   * deadline say "close now." Close and execute if so.
   *
   * Returns the list of settlement results — caller can use it to
   * invalidate downstream caches (e.g. RuleEnforcer) when any effect
   * mutated rules or authorities.
   */
  async settlePending(world: World, tick: number): Promise<ProposalSettleResult[]> {
    const pending = await this.store.getPendingProposals(world.id);
    // Lex order for deterministic conflict resolution.
    pending.sort((a, b) => a.id.localeCompare(b.id));

    const results: ProposalSettleResult[] = [];
    for (const p of pending) {
      const group = await this.store.getGroup(p.targetGroupId);
      if (!group) {
        // Target group vanished mid-life — rare but possible via
        // dissolve_group in an earlier proposal. Fail closed.
        const r = await this.markStatus(
          p,
          tick,
          'rejected',
          `target_group_missing:${p.targetGroupId}`,
        );
        results.push(r);
        continue;
      }

      const trigger = await this.shouldSettleNow(p, group, tick);
      if (!trigger) continue;

      results.push(await this.settleOne(p, group, tick, trigger.reason));
    }
    return results;
  }

  // ============================================================
  // internals
  // ============================================================

  /**
   * Decide whether `p` should close this tick. Considers the
   * proposal's deadline record and, for some procedures, early-close
   * conditions (e.g. consensus with a veto already cast).
   */
  private async shouldSettleNow(
    p: Proposal,
    group: Group,
    tick: number,
  ): Promise<{ reason: string } | null> {
    const votes = await this.store.getVotesForProposal(p.id);
    const eligible = await this.eligibleVoters(p, group);

    if (this.deadlineReached(p.deadline, tick, votes, eligible)) {
      return { reason: 'deadline_reached' };
    }

    // Procedure-specific early close.
    if (group.procedureKind === 'consensus') {
      const vetoCount = Number((group.procedureConfig as { vetoCount?: number }).vetoCount ?? 1);
      const againstWeight = votes
        .filter((v) => v.stance === 'against')
        .reduce((s, v) => s + v.weight, 0);
      if (againstWeight >= vetoCount) return { reason: 'veto_reached' };
      // Symmetric early close — when every eligible voter has cast a
      // `for` vote, consensus is reached and there's no reason to wait
      // for the deadline.
      const forCount = votes.filter((v) => v.stance === 'for').length;
      if (forCount >= eligible.length && eligible.length > 0) {
        return { reason: 'consensus_reached' };
      }
    }
    if (group.procedureKind === 'decree') {
      // Decree closes as soon as the role holder casts any vote.
      const roleName = String(
        (group.procedureConfig as { holderRole?: string }).holderRole ?? 'chair',
      );
      const role = await this.store.getGroupRole(group.id, roleName);
      if (role?.holderAgentId && votes.some((v) => v.voterAgentId === role.holderAgentId)) {
        return { reason: 'decree_cast' };
      }
    }
    return null;
  }

  private deadlineReached(
    deadline: Proposal['deadline'],
    tick: number,
    votes: Vote[],
    eligible: Agent[],
  ): boolean {
    switch (deadline.kind) {
      case 'tick':
        return tick >= deadline.at;
      case 'quorum':
        return votes.length >= deadline.need;
      case 'all_voted':
        return votes.length >= eligible.length && eligible.length > 0;
      case 'any_of':
        return deadline.options.some((opt) => this.deadlineReached(opt, tick, votes, eligible));
    }
  }

  private async eligibleVoters(p: Proposal, group: Group): Promise<Agent[]> {
    // All active members of the target group.
    const memberships = await this.store.getActiveMembershipsForGroup(group.id);
    const voters: Agent[] = [];
    for (const m of memberships) {
      const a = await this.store.getAgent(m.agentId).catch(() => null);
      if (a?.alive && a.worldId === p.worldId) voters.push(a);
    }
    return voters;
  }

  private async settleOne(
    p: Proposal,
    group: Group,
    tick: number,
    triggerReason: string,
  ): Promise<ProposalSettleResult> {
    const votes = await this.store.getVotesForProposal(p.id);
    const eligible = await this.eligibleVoters(p, group);
    const procedure = p.procedureOverride ?? {
      kind: group.procedureKind,
      config: group.procedureConfig,
    };
    const world = await this.store.loadWorld(p.worldId);

    const outcome = await this.tally(p, group, votes, eligible, procedure, tick, world);

    if (outcome.decision === 'adopt') {
      return this.adopt(p, tick, outcome.detail || triggerReason);
    }
    // expiry vs reject: if nobody voted by deadline, it's an expiry;
    // otherwise a proper reject (someone voted, they just didn't reach threshold).
    const status: ProposalStatus = votes.length === 0 ? 'expired' : 'rejected';
    return this.markStatus(p, tick, status, outcome.detail || triggerReason);
  }

  /**
   * Run the group's procedure over the collected votes. Returns
   * adoption/rejection + a human-readable detail for the event log.
   *
   * Each procedure is a tiny pure function; if we need more we add a
   * new kind here, but most real archetypes collapse to one of these
   * five.
   */
  private async tally(
    p: Proposal,
    group: Group,
    votes: Vote[],
    eligible: Agent[],
    procedure: { kind?: unknown; config?: unknown } | Record<string, unknown>,
    tick: number,
    world: World,
  ): Promise<{ decision: 'adopt' | 'reject'; detail: string }> {
    const kind = (procedure as { kind?: string }).kind ?? group.procedureKind;
    const config =
      (procedure as { config?: Record<string, unknown> }).config ?? group.procedureConfig;

    const forWeight = votes.filter((v) => v.stance === 'for').reduce((s, v) => s + v.weight, 0);
    const againstWeight = votes
      .filter((v) => v.stance === 'against')
      .reduce((s, v) => s + v.weight, 0);

    switch (kind) {
      case 'decree': {
        const roleName = String((config as { holderRole?: string }).holderRole ?? 'chair');
        const role = await this.store.getGroupRole(group.id, roleName);
        if (!role || !role.holderAgentId) {
          return { decision: 'reject', detail: `decree_no_holder:${roleName}` };
        }
        const theirVote = votes.find((v) => v.voterAgentId === role.holderAgentId);
        if (!theirVote) {
          return { decision: 'reject', detail: 'decree_holder_did_not_vote' };
        }
        return {
          decision: theirVote.stance === 'for' ? 'adopt' : 'reject',
          detail: `decree:${theirVote.stance}`,
        };
      }

      case 'vote': {
        const threshold = Number((config as { threshold?: number }).threshold ?? 0.5);
        const quorum = Number((config as { quorum?: number }).quorum ?? 0.5);
        const turnout = votes.length / Math.max(eligible.length, 1);
        if (turnout < quorum) {
          return { decision: 'reject', detail: `quorum_failed:${turnout.toFixed(2)}<${quorum}` };
        }
        const total = forWeight + againstWeight;
        const ratio = total > 0 ? forWeight / total : 0;
        return ratio >= threshold
          ? { decision: 'adopt', detail: `vote:${ratio.toFixed(2)}>=${threshold}` }
          : { decision: 'reject', detail: `vote:${ratio.toFixed(2)}<${threshold}` };
      }

      case 'consensus': {
        const vetoCount = Number((config as { vetoCount?: number }).vetoCount ?? 1);
        if (againstWeight >= vetoCount) {
          return { decision: 'reject', detail: `vetoed:${againstWeight}` };
        }
        // All eligible must have expressed a non-abstain stance for
        // consensus to be "reached." If not, this only triggers on
        // deadline — abstention blocks adoption unless a full
        // "affirmative" set was collected.
        const affirmativeCount = votes.filter((v) => v.stance === 'for').length;
        if (affirmativeCount >= eligible.length && eligible.length > 0) {
          return { decision: 'adopt', detail: 'consensus_reached' };
        }
        return { decision: 'reject', detail: 'consensus_incomplete' };
      }

      case 'lottery': {
        if (votes.length === 0) return { decision: 'reject', detail: 'lottery_no_votes' };
        // Seeded draw for replay safety. Combines world seed + proposal
        // id + tick so forked worlds (same proposal id, different
        // parent seeds) produce independent draws while a given world
        // replays deterministically.
        const rng = createRng(this.lotterySeed(p, tick, world.rngSeed));
        const pick = votes[Math.floor(rng.next() * votes.length)]!;
        return {
          decision: pick.stance === 'for' ? 'adopt' : 'reject',
          detail: `lottery:${pick.voterAgentId}:${pick.stance}`,
        };
      }

      case 'delegated': {
        // Layer-2 placeholder. A fully-wired delegated chain would
        // ask the target group's current position on this proposal
        // (mirrored into their queue). We defer that plumbing to
        // Layer 3 — for now a delegated group rejects with a clear
        // message rather than silently adopting.
        return { decision: 'reject', detail: 'delegated_unsupported_in_layer_2' };
      }

      default:
        return { decision: 'reject', detail: `unknown_procedure:${String(kind)}` };
    }
  }

  /**
   * Deterministic seed for lottery outcome. Combines world seed +
   * proposal id + settlement tick so:
   *   - the same proposal settled at the same tick in the same world
   *     always draws the same winner (replay-safe)
   *   - two forks of a world (same proposal id but different
   *     `World.rngSeed`) produce independent draws (fork semantics)
   */
  private lotterySeed(p: Proposal, tick: number, worldSeed: number): number {
    let h = 2166136261;
    const str = `${worldSeed}#${p.id}#${tick}`;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private async adopt(p: Proposal, tick: number, detail: string): Promise<ProposalSettleResult> {
    // Record the adoption event FIRST so that effect executions can
    // reference it as their `sourceEventId` (useful for authority audit).
    const world = await this.store.loadWorld(p.worldId);
    const adoptEventId = await this.store.recordEvent({
      worldId: p.worldId,
      tick,
      eventType: 'proposal_adopted',
      actorId: p.sponsorAgentId,
      data: { proposalId: p.id, title: p.title, detail },
      tokenCost: 0,
    });

    const effects = (p.compiledEffects ?? p.effects) as Effect[];
    const effectResults = await applyEffects(effects, {
      store: this.store,
      world,
      tick,
      sourceEventId: adoptEventId,
    });

    await this.store.updateProposalStatus(p.id, 'adopted', tick, detail);

    this.events.emit({
      type: 'proposal_adopted',
      worldId: p.worldId,
      proposalId: p.id,
      detail,
      effectResults,
    });

    return { proposalId: p.id, status: 'adopted', detail, effectResults };
  }

  private async markStatus(
    p: Proposal,
    tick: number,
    status: Exclude<ProposalStatus, 'pending' | 'adopted'>,
    detail: string,
  ): Promise<ProposalSettleResult> {
    await this.store.updateProposalStatus(p.id, status, tick, detail);
    await this.store.recordEvent({
      worldId: p.worldId,
      tick,
      eventType:
        status === 'rejected'
          ? 'proposal_rejected'
          : status === 'expired'
            ? 'proposal_expired'
            : 'proposal_withdrawn',
      actorId: p.sponsorAgentId,
      data: { proposalId: p.id, title: p.title, detail },
      tokenCost: 0,
    });

    this.events.emit({
      type: `proposal_${status}` as 'proposal_rejected' | 'proposal_expired' | 'proposal_withdrawn',
      worldId: p.worldId,
      proposalId: p.id,
      detail,
    });

    return { proposalId: p.id, status, detail, effectResults: [] };
  }
}
