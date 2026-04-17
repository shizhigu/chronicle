/**
 * chronicle import <file.chronicle>
 *
 * Restores a world + its per-character memory files. For archives
 * produced before schemaVersion 2, the `memories` section is absent
 * and characters start with empty memory — which is fine, nothing is
 * ever *corrupted*, just not as rich.
 *
 * Every memory entry is threat-scanned during restore. A malicious
 * .chronicle file can embed prompt-injection payloads that would
 * otherwise land in a future session's system prompt, so we refuse
 * to write any character whose memory trips the scanner.
 */

import { readFile } from 'node:fs/promises';
import { MemoryFileStore, WorldStore } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

export async function importCommand(file: string): Promise<void> {
  const raw = await readFile(file, 'utf-8');
  const bundle = JSON.parse(raw);

  const store = await WorldStore.open(paths.db);

  await store.createWorld(bundle.world);

  // Core entities.
  for (const loc of bundle.locations ?? []) await store.createLocation(loc);
  // Adjacencies come from a v3 bundle; v1/v2 archives omit them and
  // restored worlds have an empty location graph (all destinations
  // unreachable). Fall back to silent skip for legacy archives.
  for (const adj of bundle.adjacencies ?? []) {
    // `addAdjacency` writes one edge; `bidirectional=true` also
    // writes the reverse edge, so pass `false` here to avoid
    // double-inserting — we already have both directions in the
    // exported list.
    await store.addAdjacency(adj.fromId, adj.toId, adj.cost ?? 1, false);
  }
  for (const a of bundle.agents ?? []) await store.createAgent(a);
  for (const r of bundle.rules ?? []) await store.createRule(r);

  // World-specific compiled tools. Without these, schema-driven tools
  // (`check_cellar`, scenario-invented actions) disappear after
  // round-trip and the simulation behaves like a stripped-down
  // version of the original. v1/v2 archives don't carry them.
  for (const sch of bundle.actionSchemas ?? []) await store.createActionSchema(sch);

  // Resources — location-held AND agent-held. Same schemaVersion gate.
  for (const res of bundle.resources ?? []) await store.createResource(res);

  // Governance snapshot (ADR-0009). v3+ archives include these; v1/v2
  // drop them entirely, so a restored political world from a legacy
  // archive has no groups / votes / authorities. We restore groups
  // first so memberships can reference valid group ids.
  for (const g of bundle.groups ?? []) await store.createGroup(g);
  for (const { memberships = [] } of bundle.memberships ?? []) {
    for (const m of memberships) {
      try {
        await store.addMembership(m.groupId, m.agentId, m.joinedTick);
        if (m.leftTick != null) {
          await store.removeMembership(m.groupId, m.agentId, m.leftTick);
        }
      } catch (err) {
        // `addMembership` throws on duplicate — if somehow the
        // archive has an overlapping active membership, skip it
        // rather than fail the whole import.
        console.warn(
          `  ⚠ membership ${m.agentId} in ${m.groupId} skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  for (const { roles = [] } of bundle.roles ?? []) {
    for (const role of roles) await store.upsertGroupRole(role);
  }
  for (const auth of bundle.authorities ?? []) await store.grantAuthority(auth);
  for (const p of bundle.proposals ?? []) await store.createProposal(p);
  for (const { votes = [] } of bundle.votes ?? []) {
    for (const v of votes) await store.castVote(v);
  }

  // God interventions — both applied (history) and pending (queued
  // CC edits that the restored world should pick up on its next
  // tick). `queueIntervention` writes `applied: false` by default;
  // for rows that were already applied pre-export, flip the flag
  // back to applied so they don't re-fire on resume.
  for (const iv of bundle.interventions ?? []) {
    const newId = await store.queueIntervention({
      worldId: iv.worldId,
      queuedTick: iv.queuedTick,
      applyAtTick: iv.applyAtTick,
      description: iv.description,
      compiledEffects: iv.compiledEffects,
      notes: iv.notes,
    });
    if (iv.applied) {
      await store.markInterventionApplied(newId);
    }
  }

  for (const e of bundle.events ?? []) {
    await store.recordEvent({
      worldId: e.worldId,
      tick: e.tick,
      eventType: e.eventType,
      actorId: e.actorId,
      data: e.data,
      visibleTo: e.visibleTo,
      tokenCost: e.tokenCost,
    });
  }

  // Restore per-character memory files. Silently skipped for older
  // archives (schemaVersion 1) that predate the file-backed memory
  // cutover — those worlds simply resume with empty memory.
  const memories: Record<string, string> = bundle.memories ?? {};
  const worldIdForMemories: string = bundle.world.id;
  const memory = new MemoryFileStore();
  let memoryRestored = 0;
  const memoryRejected: Array<{ agentId: string; reason: string }> = [];
  for (const [agentId, content] of Object.entries(memories)) {
    if (!content) continue;
    const result = await memory.importRaw(worldIdForMemories, agentId, content);
    if (result.ok) {
      memoryRestored++;
    } else {
      memoryRejected.push({ agentId, reason: result.detail });
    }
  }

  console.log(`✓ Imported ${bundle.manifest?.worldName ?? 'world'} (${bundle.world.id})`);
  if (memoryRestored > 0 || memoryRejected.length > 0) {
    console.log(
      `  memory: ${memoryRestored} restored, ${memoryRejected.length} rejected (threat-scan)`,
    );
    for (const r of memoryRejected) {
      console.warn(`  ⚠ memory for ${r.agentId} skipped: ${r.reason}`);
    }
  }

  printNextSteps([
    `show_user "Imported. Run replay or fork to explore."`,
    `suggest_call "chronicle run ${bundle.world.id} --live"`,
  ]);
  store.close();
}
