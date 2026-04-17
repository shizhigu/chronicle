/**
 * chronicle export <worldId> --out file.chronicle
 *
 * Produces a JSON bundle describing everything needed to replay or
 * fork a world — world config, agents, locations, rules, events, AND
 * the per-character memory markdown files (schemaVersion 2+).
 *
 * Memory files live outside SQLite (see MemoryFileStore), so without
 * bundling them the export silently drops every character's durable
 * memory. Schema bump from 1→2 marks archives produced after the
 * file-backed memory cutover.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MemoryFileStore, WorldStore } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  out: string;
}

export interface ExportBundle {
  manifest: {
    schemaVersion: number;
    exportedAt: string;
    worldId: string;
    worldName: string;
    tickCount: number;
    rating: string;
  };
  world: Awaited<ReturnType<WorldStore['loadWorld']>>;
  /** Includes dead agents so post-mortem replay works. */
  agents: Awaited<ReturnType<WorldStore['getAllAgents']>>;
  locations: Awaited<ReturnType<WorldStore['getLocationsForWorld']>>;
  /**
   * Location graph edges. Without these the locations round-trip but
   * every destination is unreachable — move actions fail with
   * `not_adjacent` on the restored world.
   */
  adjacencies: Awaited<ReturnType<WorldStore['getAllAdjacencies']>>;
  rules: Awaited<ReturnType<WorldStore['getActiveRules']>>;
  events: Awaited<ReturnType<WorldStore['getRecentEvents']>>;
  /**
   * World-specific tools compiled from the scenario description. Core
   * tools (observe/speak/think/…) are built at runtime; without
   * restoring action_schemas, any schema-driven tool the scenario
   * invented (e.g. `check_cellar` on the Snowbound Inn) disappears.
   */
  actionSchemas: Awaited<ReturnType<WorldStore['getActiveActionSchemas']>>;
  /** Resource inventory — both location-held and agent-held. */
  resources: Awaited<ReturnType<WorldStore['getAllResourcesForWorld']>>;
  /**
   * Governance snapshot (ADR-0009). Without these fields, exporting
   * a world with a council / votes / granted authority silently
   * drops the entire political layer. Groups include dissolved ones
   * so the audit trail survives.
   */
  groups: Awaited<ReturnType<WorldStore['getGroupsForWorld']>>;
  memberships: Array<{
    groupId: string;
    memberships: Awaited<ReturnType<WorldStore['getAllMembershipsForGroup']>>;
  }>;
  roles: Array<{
    groupId: string;
    roles: Awaited<ReturnType<WorldStore['getRolesForGroup']>>;
  }>;
  authorities: Awaited<ReturnType<WorldStore['getAllAuthoritiesForWorld']>>;
  proposals: Awaited<ReturnType<WorldStore['getAllProposalsForWorld']>>;
  votes: Array<{
    proposalId: string;
    votes: Awaited<ReturnType<WorldStore['getVotesForProposal']>>;
  }>;
  /**
   * God interventions — applied and pending. Without these, a
   * mid-run export loses any queued CC edits (`chronicle intervene`,
   * `apply-effect`, `edit-character`, `add-rule`, etc.) and the
   * restored world resumes as if those edits had never been typed.
   */
  interventions: Awaited<ReturnType<WorldStore['getAllInterventionsForWorld']>>;
  /** agentId → raw contents of that character's memory.md (may be ''). */
  memories: Record<string, string>;
}

export async function exportCommand(worldId: string, opts: Options): Promise<void> {
  const store = await WorldStore.open(paths.db);
  const world = await store.loadWorld(worldId);
  const agents = await store.getAllAgents(worldId); // include dead
  const locations = await store.getLocationsForWorld(worldId);
  const adjacencies = await store.getAllAdjacencies(worldId);
  const events = await store.getRecentEvents(worldId, 0);
  const rules = await store.getActiveRules(worldId);
  const actionSchemas = await store.getActiveActionSchemas(worldId);
  const resources = await store.getAllResourcesForWorld(worldId);
  const groups = await store.getGroupsForWorld(worldId, /* includeDissolved */ true);
  const memberships = await Promise.all(
    groups.map(async (g) => ({
      groupId: g.id,
      memberships: await store.getAllMembershipsForGroup(g.id),
    })),
  );
  const roles = await Promise.all(
    groups.map(async (g) => ({ groupId: g.id, roles: await store.getRolesForGroup(g.id) })),
  );
  const authorities = await store.getAllAuthoritiesForWorld(worldId);
  const proposals = await store.getAllProposalsForWorld(worldId);
  const votes = await Promise.all(
    proposals.map(async (p) => ({
      proposalId: p.id,
      votes: await store.getVotesForProposal(p.id),
    })),
  );
  const interventions = await store.getAllInterventionsForWorld(worldId);

  // Read each character's memory file in parallel. MemoryFileStore.read
  // returns '' for characters who never wrote anything, so missing
  // files are captured as empty strings rather than an error.
  const memory = new MemoryFileStore();
  const memoryEntries = await Promise.all(
    agents.map(async (a) => [a.id, await memory.read(worldId, a.id)] as const),
  );
  const memories: Record<string, string> = Object.fromEntries(memoryEntries);
  const nonEmptyMemoryCount = memoryEntries.filter(([, content]) => content.length > 0).length;

  const bundle: ExportBundle = {
    manifest: {
      // Bumped 2 → 3 to signal that governance + adjacencies + resources
      // + action_schemas + dead agents are now included. Importers that
      // only understand v2 will still work for the overlapping subset.
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      worldId: world.id,
      worldName: world.name,
      tickCount: world.currentTick,
      rating: 'E', // TODO: compute from moderation results
    },
    world,
    agents,
    locations,
    adjacencies,
    rules,
    events,
    actionSchemas,
    resources,
    groups,
    memberships,
    roles,
    authorities,
    proposals,
    votes,
    interventions,
    memories,
  };

  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify(bundle, null, 2));

  console.log(`✓ Exported to ${opts.out}`);
  console.log(
    `  ${agents.length} agents · ${events.length} events · ${rules.length} rules · ${groups.length} groups · ${proposals.length} proposals · ${nonEmptyMemoryCount} memory files`,
  );

  printNextSteps([
    `show_user "Exported chronicle to ${opts.out}."`,
    `mention "Share this file with anyone who has chronicle installed."`,
    `suggest_call "chronicle import ${opts.out}"`,
  ]);
  store.close();
}
