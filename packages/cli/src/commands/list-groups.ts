/**
 * chronicle list-groups <worldId> [--json] [--include-dissolved]
 *
 * Read-only enumeration of groups in a world (ADR-0011 § 3b). Plain
 * table mode for human eyes; `--json` emits the same records as
 * JSON for CC consumption. By default dissolved groups are hidden;
 * `--include-dissolved` shows them with a dissolvedTick column.
 *
 * This command does NOT go through the effect pipeline — there's
 * nothing to mutate.
 */

import { WorldStore } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  json?: boolean;
  includeDissolved?: boolean;
}

export async function listGroupsCommand(worldId: string, opts: Options): Promise<void> {
  const store = await WorldStore.open(paths.db);
  try {
    await store.loadWorld(worldId);
    const groups = await store.getGroupsForWorld(worldId, opts.includeDissolved ?? false);

    // Augment each group with member + role counts. One round-trip per
    // group is fine for a CLI: N is typically <50 and this is a human
    // command, not a hot path.
    const enriched = await Promise.all(
      groups.map(async (g) => {
        const [memberships, roles] = await Promise.all([
          store.getActiveMembershipsForGroup(g.id),
          store.getRolesForGroup(g.id),
        ]);
        return {
          id: g.id,
          name: g.name,
          procedure: g.procedureKind,
          visibility: g.visibilityPolicy,
          members: memberships.length,
          roles: roles.length,
          foundedTick: g.foundedTick,
          dissolvedTick: g.dissolvedTick,
        };
      }),
    );

    if (opts.json) {
      console.log(JSON.stringify(enriched, null, 2));
      return;
    }

    if (enriched.length === 0) {
      console.log('(no groups)');
      printNextSteps([
        `show_user "No groups in this world yet."`,
        `suggest_call "chronicle add-group ${worldId} --name Council --description '...' --procedure vote"`,
      ]);
      return;
    }

    const idW = Math.max(4, ...enriched.map((r) => r.id.length));
    const nameW = Math.max(4, ...enriched.map((r) => r.name.length));
    const procW = Math.max(4, ...enriched.map((r) => r.procedure.length));
    const visW = Math.max(5, ...enriched.map((r) => r.visibility.length));
    // MEMBERS and ROLES columns have fixed-width headers (7 and 5).
    const memW = 7;
    const roleW = 5;

    const header =
      `${'ID'.padEnd(idW)}  ${'NAME'.padEnd(nameW)}  ${'PROC'.padEnd(procW)}  ` +
      `${'VIS'.padEnd(visW)}  ${'MEMBERS'.padEnd(memW)}  ${'ROLES'.padEnd(roleW)}  STATUS`;
    console.log(header);
    console.log('-'.repeat(header.length));
    for (const g of enriched) {
      const status = g.dissolvedTick != null ? `dissolved@${g.dissolvedTick}` : 'active';
      console.log(
        `${g.id.padEnd(idW)}  ${g.name.padEnd(nameW)}  ${g.procedure.padEnd(procW)}  ` +
          `${g.visibility.padEnd(visW)}  ${String(g.members).padEnd(memW)}  ` +
          `${String(g.roles).padEnd(roleW)}  ${status}`,
      );
    }

    printNextSteps([
      `show_user "${enriched.length} group${enriched.length === 1 ? '' : 's'} in world ${worldId}."`,
      `mention "Use chronicle add-group to create more, or chronicle apply-effect with dissolve_group to retire one."`,
    ]);
  } finally {
    store.close();
  }
}
