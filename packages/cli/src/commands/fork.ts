import {
  type Agent,
  type Location,
  type Resource,
  agentId,
  authorityId,
  groupId,
  locationId,
  worldId as newWorldId,
  proposalId,
  randomSeed,
  resourceId,
  ruleId,
} from '@chronicle/core';
import { MemoryFileStore, WorldStore } from '@chronicle/engine';
import { CliError, ExitCode } from '../exit-codes.js';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  atTick?: string;
  desc?: string;
}

export async function forkCommand(srcWorldId: string, opts: Options): Promise<void> {
  if (!opts.desc) {
    throw new CliError(
      'fork: --desc is required (summarise what this fork changes)',
      ExitCode.Generic,
    );
  }

  const store = await WorldStore.open(paths.db);
  try {
    const src = await store.loadWorld(srcWorldId);
    const forkTick = opts.atTick ? Number.parseInt(opts.atTick, 10) : src.currentTick;
    if (!Number.isFinite(forkTick) || forkTick < 0 || forkTick > src.currentTick) {
      throw new CliError(
        `fork: --at-tick must be in [0, ${src.currentTick}] for world ${srcWorldId}`,
        ExitCode.Generic,
      );
    }

    // Build id-rewrite maps so the clone doesn't collide with the source.
    // Every entity gets a fresh id; we keep a map so event data_json
    // references (actorId, targetAgentId, etc.) can be translated
    // across the boundary.
    const destWorldId = newWorldId();
    const agents = await store.getAllAgents(srcWorldId);
    const agentIdMap = new Map<string, string>(agents.map((a) => [a.id, agentId()]));
    const locations = await store.getLocationsForWorld(srcWorldId);
    const locIdMap = new Map<string, string>(locations.map((l) => [l.id, locationId()]));
    const groups = await store.getGroupsForWorld(srcWorldId, /* includeDissolved */ true);
    const groupIdMap = new Map<string, string>(groups.map((g) => [g.id, groupId()]));
    const proposals = await store.getAllProposalsForWorld(srcWorldId);
    const proposalIdMap = new Map<string, string>(proposals.map((p) => [p.id, proposalId()]));
    const authorities = await store.getAllAuthoritiesForWorld(srcWorldId);
    const authIdMap = new Map<string, string>(authorities.map((a) => [a.id, authorityId()]));
    const resources = await store.getAllResourcesForWorld(srcWorldId);
    const resourceIdMap = new Map<string, string>(resources.map((r) => [r.id, resourceId()]));
    const rules = await store.getActiveRules(srcWorldId);
    const ruleIdMap = new Map<string, string>(rules.map((r) => [r.id, ruleId()]));

    // Walk all entity ids that might appear as values in event data
    // and return the rewritten version. Conservative: anything we
    // don't recognise passes through unchanged.
    const remap = (val: unknown): string | undefined =>
      typeof val === 'string'
        ? (agentIdMap.get(val) ??
          locIdMap.get(val) ??
          groupIdMap.get(val) ??
          proposalIdMap.get(val) ??
          authIdMap.get(val) ??
          resourceIdMap.get(val) ??
          ruleIdMap.get(val))
        : undefined;

    function remapJson(v: unknown): unknown {
      if (typeof v === 'string') {
        const mapped = remap(v);
        return mapped ?? v;
      }
      if (Array.isArray(v)) return v.map(remapJson);
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v)) out[k] = remapJson(val);
        return out;
      }
      return v;
    }

    // 1. Clone the world with fresh id + forkFromTick pinned.
    await store.createWorld({
      ...src,
      id: destWorldId,
      name: `${src.name} (fork @ ${forkTick})`,
      description: opts.desc,
      forkFromTick: forkTick,
      createdByChronicle: src.id,
      currentTick: forkTick,
      status: 'paused',
      tokensUsed: 0,
      rngSeed: randomSeed(),
      createdAt: new Date().toISOString(),
    });

    // 2. Locations + adjacencies.
    for (const loc of locations) {
      const cloned: Location = { ...loc, id: locIdMap.get(loc.id)!, worldId: destWorldId };
      await store.createLocation(cloned);
    }
    for (const adj of await store.getAllAdjacencies(srcWorldId)) {
      const from = locIdMap.get(adj.fromId);
      const to = locIdMap.get(adj.toId);
      if (from && to) await store.addAdjacency(from, to, adj.cost, false);
    }

    // 3. Agents. Preserve persona / memory / mood — but NOT the
    // mid-turn session blob (pi-agent transcripts don't translate
    // cleanly across re-identified agents). Forked agents start
    // fresh transcripts but keep durable memory.
    for (const a of agents) {
      const cloned: Agent = {
        ...a,
        id: agentIdMap.get(a.id)!,
        worldId: destWorldId,
        locationId: a.locationId ? (locIdMap.get(a.locationId) ?? null) : null,
        sessionStateBlob: null,
      };
      await store.createAgent(cloned);
    }

    // 4. Rules.
    for (const r of rules) {
      await store.createRule({
        ...r,
        id: ruleIdMap.get(r.id)!,
        worldId: destWorldId,
        scopeRef:
          r.scopeKind === 'agent' && r.scopeRef
            ? (agentIdMap.get(r.scopeRef) ?? r.scopeRef)
            : r.scopeKind === 'group' && r.scopeRef
              ? (groupIdMap.get(r.scopeRef) ?? r.scopeRef)
              : r.scopeKind === 'location' && r.scopeRef
                ? (locIdMap.get(r.scopeRef) ?? r.scopeRef)
                : r.scopeRef,
      });
    }

    // 5. Action schemas (structurally world-scoped, just re-point worldId).
    for (const sch of await store.getActiveActionSchemas(srcWorldId)) {
      await store.createActionSchema({ ...sch, worldId: destWorldId });
    }

    // 6. Resources. Owner is either an agent or a location (never both).
    for (const r of resources) {
      const cloned: Resource = {
        ...r,
        id: resourceIdMap.get(r.id)!,
        worldId: destWorldId,
        ownerAgentId: r.ownerAgentId ? (agentIdMap.get(r.ownerAgentId) ?? null) : null,
        ownerLocationId: r.ownerLocationId ? (locIdMap.get(r.ownerLocationId) ?? null) : null,
      };
      await store.createResource(cloned);
    }

    // 7. Governance snapshot.
    for (const g of groups) {
      await store.createGroup({ ...g, id: groupIdMap.get(g.id)!, worldId: destWorldId });
    }
    for (const g of groups) {
      const ms = await store.getAllMembershipsForGroup(g.id);
      for (const m of ms) {
        const newGid = groupIdMap.get(m.groupId);
        const newAid = agentIdMap.get(m.agentId);
        if (!newGid || !newAid) continue;
        try {
          await store.addMembership(newGid, newAid, m.joinedTick);
          if (m.leftTick != null) await store.removeMembership(newGid, newAid, m.leftTick);
        } catch {
          /* duplicate active membership — ignore in fork flow */
        }
      }
      for (const role of await store.getRolesForGroup(g.id)) {
        await store.upsertGroupRole({
          ...role,
          groupId: groupIdMap.get(role.groupId)!,
          holderAgentId: role.holderAgentId ? (agentIdMap.get(role.holderAgentId) ?? null) : null,
        });
      }
    }
    for (const auth of authorities) {
      // Only translate the holder ref shape we know; role refs look
      // like "groupId#roleName", preserve the role suffix verbatim.
      const newHolderRef =
        auth.holderKind === 'agent'
          ? (agentIdMap.get(auth.holderRef) ?? auth.holderRef)
          : auth.holderKind === 'group'
            ? (groupIdMap.get(auth.holderRef) ?? auth.holderRef)
            : (() => {
                const [gid, role] = auth.holderRef.split('#', 2);
                return gid
                  ? `${groupIdMap.get(gid) ?? gid}${role ? `#${role}` : ''}`
                  : auth.holderRef;
              })();
      await store.grantAuthority({
        ...auth,
        id: authIdMap.get(auth.id)!,
        worldId: destWorldId,
        holderRef: newHolderRef,
      });
    }
    for (const p of proposals) {
      await store.createProposal({
        ...p,
        id: proposalIdMap.get(p.id)!,
        worldId: destWorldId,
        targetGroupId: groupIdMap.get(p.targetGroupId) ?? p.targetGroupId,
        sponsorAgentId: agentIdMap.get(p.sponsorAgentId) ?? p.sponsorAgentId,
      });
      for (const v of await store.getVotesForProposal(p.id)) {
        await store.castVote({
          ...v,
          proposalId: proposalIdMap.get(v.proposalId)!,
          voterAgentId: agentIdMap.get(v.voterAgentId) ?? v.voterAgentId,
        });
      }
    }

    // 8. Events up to the fork tick. Remap any embedded entity
    // references inside data_json so the forked event log points at
    // the forked entities.
    const events = await store.getEventsInRange(srcWorldId, 0, forkTick);
    for (const e of events) {
      await store.recordEvent({
        worldId: destWorldId,
        tick: e.tick,
        eventType: e.eventType,
        actorId: e.actorId ? (agentIdMap.get(e.actorId) ?? null) : null,
        data: remapJson(e.data) as Record<string, unknown>,
        visibleTo: e.visibleTo.map((id) => agentIdMap.get(id) ?? id),
        tokenCost: e.tokenCost,
      });
    }

    // 9. Memory files — copy source's per-character memory to the
    // forked agents' paths. Memories are opaque markdown paragraphs
    // so they don't need remapping, just re-homing.
    const memory = new MemoryFileStore();
    for (const srcAgent of agents) {
      const newAid = agentIdMap.get(srcAgent.id);
      if (!newAid) continue;
      const srcMem = await memory.read(srcWorldId, srcAgent.id);
      if (srcMem.length > 0) {
        const result = await memory.importRaw(destWorldId, newAid, srcMem);
        if (!result.ok) {
          console.warn(`  ⚠ memory for ${srcAgent.name} skipped: ${result.detail}`);
        }
      }
    }

    console.log(`✓ forked ${srcWorldId} → ${destWorldId} at tick ${forkTick}`);
    console.log(`  ${agents.length} agents · ${events.length} events · ${groups.length} groups`);

    printNextSteps([
      `show_user "Forked world created: ${destWorldId} (fork @ tick ${forkTick})"`,
      `suggest_call "chronicle run ${destWorldId} --ticks 20 --live"`,
      `suggest_call "chronicle dashboard ${destWorldId}"`,
    ]);
  } finally {
    store.close();
  }
}
