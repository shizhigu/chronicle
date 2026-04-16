/**
 * EffectRegistry — the single executor for typed state mutations.
 *
 * An **Effect** (see `@chronicle/core` types) is a serializable
 * instruction. Proposals carry effects as their payload; god
 * interventions compile to the same format. One registry handles
 * both paths — no code duplication, one place to add new effect
 * kinds, one place to enforce inviolable-rule guards.
 *
 * Each effect kind exposes two hooks:
 *
 *   - `validate(effect, ctx)` — called at proposal creation time AND
 *     again just before execution. Returns `null` if OK or a string
 *     reason if the effect is malformed / references missing entities
 *     / would violate an inviolable rule. Validation is pure (no DB
 *     mutation); idempotent.
 *
 *   - `execute(effect, ctx)` — applies the mutation. Returns a short
 *     detail string for the outcome audit trail. If `execute` throws,
 *     the caller records the effect as failed without touching other
 *     effects in the same proposal — we do NOT wrap the whole batch
 *     in a transaction because some effects (e.g. create_location)
 *     have natural downstream cascades (resource creation) that later
 *     effects in the batch may depend on.
 *
 * Design:
 *   - Pure handler table; no branching in the caller.
 *   - Adding a new effect = one entry in the registry + an entry in
 *     the Effect union in core types. No changes to callers.
 *   - Each handler's code is small and obvious; do not hide logic in
 *     the handler or the caller gets pulled in both directions.
 */

import type { Effect, EffectKind, World } from '@chronicle/core';
import {
  authorityId as newAuthorityId,
  groupId as newGroupId,
  locationId as newLocationId,
  ruleId as newRuleId,
} from '@chronicle/core';
import type { WorldStore } from '../store.js';

export interface EffectContext {
  store: WorldStore;
  world: World;
  /** Tick at which the effect is being applied. */
  tick: number;
  /** Event id for audit trail on grant_authority / revoke_authority. */
  sourceEventId?: number | null;
}

export interface EffectResult {
  ok: boolean;
  detail: string;
  /**
   * Ids of newly-created entities. Useful for chaining effects within
   * one proposal ("create this group, then make Alice chair of it")
   * and for dashboard highlighting.
   */
  created?: Record<string, string>;
}

type EffectHandler<K extends EffectKind> = {
  validate: (effect: Extract<Effect, { kind: K }>, ctx: EffectContext) => Promise<string | null>;
  execute: (effect: Extract<Effect, { kind: K }>, ctx: EffectContext) => Promise<EffectResult>;
};

// Discriminated-union-preserving handler map. Each kind keeps its
// own narrowed Effect shape.
type Registry = { [K in EffectKind]: EffectHandler<K> };

// ============================================================
// Inviolable rules — the L0 safety floor from ADR-0009.
//
// These rules can never be repealed by any proposal or god
// intervention. Runtime safety: memory threat-scan and bans on rules
// that would grant shell access or introduce non-determinism are all
// expressed as regular rules with these tags. EffectRegistry refuses
// to `repeal_rule` on any rule whose `compilerNotes` contains this
// marker.
// ============================================================

export const INVIOLABLE_MARKER = 'inviolable:true';

function isInviolable(compilerNotes: string | null): boolean {
  return typeof compilerNotes === 'string' && compilerNotes.includes(INVIOLABLE_MARKER);
}

/**
 * Per-kind structural validation for AuthorityPower elements. The
 * discriminated union declares required fields per `kind`, but those
 * are compile-time contracts — at runtime a caller could pass
 * `{kind:'override_rule'}` with no `ruleId`, and TypeScript is not
 * there to catch it. This validator enforces the contract.
 *
 * Returns `null` on valid input, or a short tag describing the
 * missing / malformed field. One case per AuthorityPower kind — add
 * a case when the union grows.
 */
function validateAuthorityPowerShape(p: import('@chronicle/core').AuthorityPower): string | null {
  if (!p || typeof p !== 'object') return 'not_an_object';
  // biome-ignore lint/suspicious/noExplicitAny: narrowing an untyped union from the wire
  const raw = p as any;
  if (typeof raw.kind !== 'string') return 'kind_missing';
  switch (raw.kind) {
    case 'override_rule':
      if (typeof raw.ruleId !== 'string' || raw.ruleId.length === 0) {
        return 'override_rule_requires_ruleId';
      }
      return null;
    case 'propose':
      if (!Array.isArray(raw.effectTypes) || raw.effectTypes.length === 0) {
        return 'propose_requires_effectTypes';
      }
      return null;
    case 'execute_effect':
      if (typeof raw.effectType !== 'string' || raw.effectType.length === 0) {
        return 'execute_effect_requires_effectType';
      }
      return null;
    case 'grant_authority':
      // maxScope is optional — no required fields besides kind.
      return null;
    case 'inviolable':
      return null;
    default:
      return `unknown_power_kind:${raw.kind}`;
  }
}

// ============================================================
// Registry
// ============================================================

const REGISTRY: Registry = {
  // ---------- entity lifecycle ----------

  create_location: {
    validate: async (e, { store, world }) => {
      if (!e.name.trim()) return 'empty_name';
      const existing = await store.getLocationsForWorld(world.id);
      if (existing.some((l) => l.name.toLowerCase() === e.name.toLowerCase())) {
        return `duplicate_location_name:${e.name}`;
      }
      if (e.adjacentTo) {
        for (const adj of e.adjacentTo) {
          if (!existing.some((l) => l.name.toLowerCase() === adj.toLowerCase())) {
            return `missing_adjacent_location:${adj}`;
          }
        }
      }
      return null;
    },
    execute: async (e, { store, world }) => {
      const id = newLocationId();
      await store.createLocation({
        id,
        worldId: world.id,
        name: e.name,
        description: e.description,
        x: null,
        y: null,
        parentId: null,
        affordances: [],
        metadata: {},
        spriteHint: e.spriteHint ?? null,
        createdAt: new Date().toISOString(),
      });
      if (e.adjacentTo) {
        const all = await store.getLocationsForWorld(world.id);
        for (const adjName of e.adjacentTo) {
          const peer = all.find((l) => l.name.toLowerCase() === adjName.toLowerCase());
          if (peer) await store.addAdjacency(id, peer.id, 1, true);
        }
      }
      return {
        ok: true,
        detail: `location_created:${e.name}`,
        created: { locationId: id },
      };
    },
  },

  create_group: {
    validate: async (e, { store, world }) => {
      if (!e.name.trim()) return 'empty_name';
      const existing = await store.getGroupsForWorld(world.id);
      if (existing.some((g) => g.name.toLowerCase() === e.name.toLowerCase())) {
        return `duplicate_group_name:${e.name}`;
      }
      if (e.initialMembers) {
        for (const aid of e.initialMembers) {
          const a = await store.getAgent(aid).catch(() => null);
          if (!a || a.worldId !== world.id) return `missing_member:${aid}`;
        }
      }
      return null;
    },
    execute: async (e, { store, world, tick }) => {
      const id = newGroupId();
      await store.createGroup({
        id,
        worldId: world.id,
        name: e.name,
        description: e.description,
        procedureKind: e.procedure,
        procedureConfig: e.procedureConfig ?? {},
        joinPredicate: null,
        successionKind: null,
        visibilityPolicy: e.visibility ?? 'open',
        foundedTick: tick,
        dissolvedTick: null,
        createdAt: new Date().toISOString(),
      });
      for (const aid of e.initialMembers ?? []) {
        await store.addMembership(id, aid, tick);
      }
      return {
        ok: true,
        detail: `group_created:${e.name}`,
        created: { groupId: id },
      };
    },
  },

  dissolve_group: {
    validate: async (e, { store }) => {
      const g = await store.getGroup(e.groupId);
      if (!g) return `no_group:${e.groupId}`;
      if (g.dissolvedTick !== null) return 'already_dissolved';
      return null;
    },
    execute: async (e, { store, tick }) => {
      await store.dissolveGroup(e.groupId, tick);
      return { ok: true, detail: `group_dissolved:${e.groupId}` };
    },
  },

  create_rule: {
    validate: async (e) => {
      if (!e.description.trim()) return 'empty_description';
      if (e.tier === 'hard' && !e.check) return 'hard_rule_missing_check';
      return null;
    },
    execute: async (e, { store, world, tick }) => {
      const id = newRuleId();
      await store.createRule({
        id,
        worldId: world.id,
        description: e.description,
        tier: e.tier,
        hardPredicate: e.predicate,
        hardCheck: e.check,
        hardOnViolation: e.onViolation ?? 'reject',
        softNormText: e.softNormText,
        softDetectionPrompt: undefined,
        softConsequence: undefined,
        economicActionType: e.economicActionType,
        economicCostFormula: e.economicCostFormula,
        active: true,
        priority: 100,
        scopeKind: e.scopeKind ?? 'world',
        scopeRef: e.scopeRef ?? null,
        createdAt: new Date().toISOString(),
        createdByTick: tick,
        compilerNotes: null,
      });
      return {
        ok: true,
        detail: `rule_created:${id}`,
        created: { ruleId: id },
      };
    },
  },

  repeal_rule: {
    validate: async (e, { store, world }) => {
      const rules = await store.getActiveRules(world.id);
      const r = rules.find((x) => x.id === e.ruleId);
      if (!r) return `no_rule:${e.ruleId}`;
      if (isInviolable(r.compilerNotes)) return `inviolable_rule:${e.ruleId}`;
      return null;
    },
    execute: async (e, { store, world }) => {
      // We don't have a real "deactivate rule" method — mirror it via
      // raw SQL. Tests would notice if the rule still fired so the
      // semantic is load-bearing.
      const db = store.raw;
      db.query('UPDATE rules SET active = 0 WHERE id = ? AND world_id = ?').run(e.ruleId, world.id);
      return { ok: true, detail: `rule_repealed:${e.ruleId}` };
    },
  },

  // ---------- membership & role ----------

  add_member: {
    validate: async (e, { store, world }) => {
      const g = await store.getGroup(e.groupId);
      if (!g || g.worldId !== world.id) return `no_group:${e.groupId}`;
      if (g.dissolvedTick !== null) return 'group_dissolved';
      const a = await store.getAgent(e.agentId).catch(() => null);
      if (!a || a.worldId !== world.id) return `no_agent:${e.agentId}`;
      if (await store.isMember(g.id, a.id)) return 'already_member';
      return null;
    },
    execute: async (e, { store, tick }) => {
      await store.addMembership(e.groupId, e.agentId, tick);
      return { ok: true, detail: `member_added:${e.agentId}` };
    },
  },

  remove_member: {
    validate: async (e, { store }) => {
      const g = await store.getGroup(e.groupId);
      if (!g) return `no_group:${e.groupId}`;
      if (!(await store.isMember(g.id, e.agentId))) return 'not_a_member';
      return null;
    },
    execute: async (e, { store, tick }) => {
      await store.removeMembership(e.groupId, e.agentId, tick);
      // Vacate any role this agent held in the group.
      const roles = await store.getRolesForGroup(e.groupId);
      for (const role of roles) {
        if (role.holderAgentId === e.agentId) {
          await store.upsertGroupRole({ ...role, holderAgentId: null, assignedTick: tick });
        }
      }
      return { ok: true, detail: `member_removed:${e.agentId}` };
    },
  },

  assign_role: {
    validate: async (e, { store, world }) => {
      const g = await store.getGroup(e.groupId);
      if (!g || g.worldId !== world.id) return `no_group:${e.groupId}`;
      if (!(await store.isMember(g.id, e.agentId))) return 'agent_not_in_group';
      return null;
    },
    execute: async (e, { store, tick }) => {
      await store.upsertGroupRole({
        groupId: e.groupId,
        roleName: e.roleName,
        holderAgentId: e.agentId,
        assignedTick: tick,
        votingWeight: e.votingWeight ?? 1.0,
        scopeRef: e.scopeRef ?? null,
      });
      return { ok: true, detail: `role_assigned:${e.roleName}=${e.agentId}` };
    },
  },

  vacate_role: {
    validate: async (e, { store }) => {
      const existing = await store.getGroupRole(e.groupId, e.roleName);
      if (!existing) return `no_role:${e.roleName}`;
      return null;
    },
    execute: async (e, { store, tick }) => {
      const existing = await store.getGroupRole(e.groupId, e.roleName);
      // Safe: validate above checked existence; redundant guard in case
      // of a race if future code makes delete-role possible.
      if (!existing) return { ok: false, detail: `no_role:${e.roleName}` };
      await store.upsertGroupRole({
        ...existing,
        holderAgentId: null,
        assignedTick: tick,
      });
      return { ok: true, detail: `role_vacated:${e.roleName}` };
    },
  },

  // ---------- authority ----------

  grant_authority: {
    validate: async (e, { store, world }) => {
      if (e.powers.length === 0) return 'no_powers_specified';
      // Per-power shape check. The AuthorityPower union declares
      // per-kind required fields; without this loop a caller could
      // persist `{kind:'override_rule'}` (no ruleId) and the downstream
      // enforcer lookup would silently miss — worst failure mode for a
      // governance primitive. One validator per kind keeps the switch
      // cheap and makes adding a new power kind a one-case append.
      for (let i = 0; i < e.powers.length; i++) {
        const p = e.powers[i]!;
        const shapeError = validateAuthorityPowerShape(p);
        if (shapeError !== null) return `malformed_power[${i}]:${shapeError}`;
      }
      // Holder-world boundary check is also enforced in
      // WorldStore.grantAuthority; validating here lets us surface a
      // clean proposal-rejection reason before attempting the insert.
      if (e.holderKind === 'agent') {
        const a = await store.getAgent(e.holderRef).catch(() => null);
        if (!a || a.worldId !== world.id) return `bad_holder:${e.holderRef}`;
      } else if (e.holderKind === 'group') {
        const g = await store.getGroup(e.holderRef);
        if (!g || g.worldId !== world.id) return `bad_holder:${e.holderRef}`;
      } else {
        // role: holderRef is "groupId#roleName"
        const [gid] = e.holderRef.split('#');
        if (!gid) return `malformed_role_ref:${e.holderRef}`;
        const g = await store.getGroup(gid);
        if (!g || g.worldId !== world.id) return `bad_holder:${e.holderRef}`;
      }
      return null;
    },
    execute: async (e, { store, world, tick, sourceEventId }) => {
      const id = newAuthorityId();
      await store.grantAuthority({
        id,
        worldId: world.id,
        holderKind: e.holderKind,
        holderRef: e.holderRef,
        powers: e.powers,
        grantedTick: tick,
        expiresTick: e.expiresTick ?? null,
        sourceEventId: sourceEventId ?? null,
        revokedTick: null,
        revocationEventId: null,
      });
      return {
        ok: true,
        detail: `authority_granted:${id}`,
        created: { authorityId: id },
      };
    },
  },

  revoke_authority: {
    validate: async (e, { store, world }) => {
      // Existence + inviolable check. An authority carrying the
      // `{kind:'inviolable'}` power is L0 seeded and never revocable
      // — blocking it here closes a privilege-escalation chain where
      // a malicious proposal could first grant itself broad powers
      // and then revoke the engine's own safety authorities.
      const active = await store.getActiveAuthoritiesForWorld(world.id, world.currentTick + 1);
      const target = active.find((a) => a.id === e.authorityId);
      if (!target) return `no_authority:${e.authorityId}`;
      if (target.powers.some((p) => p.kind === 'inviolable')) {
        return `inviolable_authority:${e.authorityId}`;
      }
      return null;
    },
    execute: async (e, { store, tick, sourceEventId }) => {
      await store.revokeAuthority(e.authorityId, tick, sourceEventId ?? null);
      return { ok: true, detail: `authority_revoked:${e.authorityId}` };
    },
  },

  // ---------- structural change ----------

  change_procedure: {
    validate: async (e, { store }) => {
      const g = await store.getGroup(e.groupId);
      if (!g) return `no_group:${e.groupId}`;
      if (g.dissolvedTick !== null) return 'group_dissolved';
      return null;
    },
    execute: async (e, { store, world }) => {
      // No dedicated store method — use raw SQL to update the two
      // procedure columns. We keep the rest of the group row intact.
      const db = store.raw;
      db.query(
        'UPDATE groups SET procedure_kind = ?, procedure_config_json = ? WHERE id = ? AND world_id = ?',
      ).run(e.newProcedure, JSON.stringify(e.newConfig ?? {}), e.groupId, world.id);
      return { ok: true, detail: `procedure_changed:${e.groupId}=${e.newProcedure}` };
    },
  },

  // ---------- resources ----------

  update_agent: {
    validate: async (e, { store, world }) => {
      if (
        e.persona === undefined &&
        e.mood === undefined &&
        e.privateState === undefined &&
        e.traits === undefined
      ) {
        return 'update_agent_no_changes';
      }
      const a = await store.getAgent(e.agentId).catch(() => null);
      if (!a || a.worldId !== world.id) return `no_agent:${e.agentId}`;
      return null;
    },
    execute: async (e, { store }) => {
      await store.updateAgentState(e.agentId, {
        ...(e.persona !== undefined ? { persona: e.persona } : {}),
        ...(e.mood !== undefined ? { mood: e.mood } : {}),
        ...(e.privateState !== undefined ? { privateState: e.privateState } : {}),
        ...(e.traits !== undefined ? { traits: e.traits } : {}),
      });
      return { ok: true, detail: `agent_updated:${e.agentId}` };
    },
  },

  transfer_resource: {
    validate: async (e, { store }) => {
      if (e.quantity <= 0) return 'non_positive_quantity';
      // Resource existence check requires a direct fetch; we
      // approximate by touching owners via raw SQL. Simpler: let
      // execute fail if the row is gone and report it.
      if (e.toOwnerKind === 'agent') {
        const a = await store.getAgent(e.toOwnerRef).catch(() => null);
        if (!a) return `no_agent:${e.toOwnerRef}`;
      }
      return null;
    },
    execute: async (e, { store, world }) => {
      // Locate the resource. All resource transfers are intra-world,
      // so we carry `world.id` from the EffectContext for the newly
      // created row — no need to re-derive it from the source row.
      const db = store.raw;
      const row = db
        .query<
          {
            id: string;
            type: string;
            quantity: number;
            owner_agent_id: string | null;
            owner_location_id: string | null;
          },
          [string]
        >(
          'SELECT id, type, quantity, owner_agent_id, owner_location_id FROM resources WHERE id = ?',
        )
        .get(e.resourceId);
      if (!row) return { ok: false, detail: `no_resource:${e.resourceId}` };
      if (row.quantity < e.quantity) return { ok: false, detail: 'insufficient_quantity' };

      await store.adjustResourceQuantity(row.id, -e.quantity);

      const { resourceId } = await import('@chronicle/core');
      if (e.toOwnerKind === 'agent') {
        const owned = await store.getResourcesOwnedBy(e.toOwnerRef);
        const existing = owned.find((r) => r.type === row.type);
        if (existing) {
          await store.adjustResourceQuantity(existing.id, e.quantity);
        } else {
          await store.createResource({
            id: resourceId(),
            worldId: world.id,
            type: row.type,
            ownerAgentId: e.toOwnerRef,
            ownerLocationId: null,
            quantity: e.quantity,
            metadata: {},
          });
        }
      } else {
        // location destination — same resource type at a location may
        // already exist; create a fresh stack rather than merging
        // (locations can hold multiple stacks of the same type from
        // different sources, semantically). If merging is desired
        // later, add a lookup here.
        await store.createResource({
          id: resourceId(),
          worldId: world.id,
          type: row.type,
          ownerAgentId: null,
          ownerLocationId: e.toOwnerRef,
          quantity: e.quantity,
          metadata: {},
        });
      }
      return { ok: true, detail: `resource_transferred:${row.type}×${e.quantity}` };
    },
  },
};

// ============================================================
// Public API
// ============================================================

/**
 * Validate a batch of effects. Returns `null` on success or an object
 * with the first failing index + reason. Validation is "fail fast" —
 * a proposal with 5 effects is invalid if any one fails.
 */
export async function validateEffects(
  effects: Effect[],
  ctx: EffectContext,
): Promise<{ index: number; reason: string } | null> {
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i]!;
    // Guard against unknown effect kinds before indexing into the
    // registry — crafted .chronicle files or a stale CC skill could
    // emit a kind we don't handle. Without this guard we'd hit a
    // TypeError on `handler.validate`.
    if (!isKnownEffectKind(e.kind)) {
      return { index: i, reason: `unknown_effect_kind:${e.kind}` };
    }
    const handler = REGISTRY[e.kind] as EffectHandler<typeof e.kind>;
    // biome-ignore lint/suspicious/noExplicitAny: narrowed at runtime via e.kind
    const reason = await handler.validate(e as any, ctx);
    if (reason !== null) return { index: i, reason };
  }
  return null;
}

/**
 * Apply a batch of effects sequentially. Each effect is re-validated
 * right before execution — not just at proposal creation — because
 * world state may have shifted between proposal and adoption (a group
 * could have been dissolved, an agent could have left). A validation
 * failure records an `ok:false` result and skips to the next effect;
 * it does NOT roll back earlier effects, since later effects in a
 * batch often depend on earlier ones within the same proposal and
 * partial progress is the realistic outcome of a political act.
 */
export async function applyEffects(effects: Effect[], ctx: EffectContext): Promise<EffectResult[]> {
  const results: EffectResult[] = [];
  for (const e of effects) {
    if (!isKnownEffectKind(e.kind)) {
      results.push({ ok: false, detail: `unknown_effect_kind:${e.kind}` });
      continue;
    }
    const handler = REGISTRY[e.kind] as EffectHandler<typeof e.kind>;
    try {
      // biome-ignore lint/suspicious/noExplicitAny: narrowed at runtime via e.kind
      const reason = await handler.validate(e as any, ctx);
      if (reason !== null) {
        results.push({ ok: false, detail: `validate_failed:${reason}` });
        continue;
      }
      // biome-ignore lint/suspicious/noExplicitAny: narrowed at runtime via e.kind
      const r = await handler.execute(e as any, ctx);
      results.push(r);
    } catch (err) {
      results.push({
        ok: false,
        detail: `effect_threw:${(err as Error).message ?? String(err)}`,
      });
    }
  }
  return results;
}

/** True iff the registry knows how to handle this effect kind. */
export function isKnownEffectKind(kind: string): kind is EffectKind {
  return kind in REGISTRY;
}
