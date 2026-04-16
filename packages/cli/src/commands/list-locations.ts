/**
 * chronicle list-locations <worldId> [--json]
 *
 * Read-only enumeration of locations. Plain mode prints a table with
 * the adjacency graph rendered as comma-joined peer names; `--json`
 * emits structured records with adjacent-peer id arrays.
 *
 * Note: the adjacency peers in plain mode are resolved to names for
 * readability; `--json` keeps ids since consumers are programmatic.
 */

import { WorldStore } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  json?: boolean;
}

export async function listLocationsCommand(worldId: string, opts: Options): Promise<void> {
  const store = await WorldStore.open(paths.db);
  try {
    await store.loadWorld(worldId);
    const locations = await store.getLocationsForWorld(worldId);

    // --json short-circuit: machine consumers only want ids, so skip
    // the id→name resolution entirely rather than compute-and-drop.
    if (opts.json) {
      const jsonRows = await Promise.all(
        locations.map(async (l) => ({
          id: l.id,
          name: l.name,
          description: l.description,
          adjacentIds: await store.getAdjacentLocations(l.id),
        })),
      );
      console.log(JSON.stringify(jsonRows, null, 2));
      return;
    }

    // Plain-text path: resolve adjacency ids to names for readability.
    const byId = new Map(locations.map((l) => [l.id, l.name] as const));
    const enriched = await Promise.all(
      locations.map(async (l) => {
        const adjacentIds = await store.getAdjacentLocations(l.id);
        const adjacentNames = adjacentIds.map((id) => byId.get(id) ?? id);
        return {
          id: l.id,
          name: l.name,
          description: l.description,
          adjacentIds,
          adjacentNames,
        };
      }),
    );

    if (enriched.length === 0) {
      console.log('(no locations)');
      printNextSteps([
        `show_user "No locations in this world yet."`,
        `suggest_call "chronicle add-location ${worldId} --name Harbor --description '...'"`,
      ]);
      return;
    }

    const idW = Math.max(4, ...enriched.map((r) => r.id.length));
    const nameW = Math.max(4, ...enriched.map((r) => r.name.length));
    // Header + separator cover only the fixed-width columns. The
    // ADJACENT column is data-length-variable (joined peer names) so
    // trying to extend the separator across it produces visual
    // misalignment for any non-trivial world — we just end the rule
    // at the last fixed column instead.
    const header = `${'ID'.padEnd(idW)}  ${'NAME'.padEnd(nameW)}  ADJACENT`;
    console.log(header);
    console.log('-'.repeat(idW + 2 + nameW + 2 + 8)); // "ADJACENT" = 8
    for (const l of enriched) {
      const adj = l.adjacentNames.length === 0 ? '(isolated)' : l.adjacentNames.join(', ');
      console.log(`${l.id.padEnd(idW)}  ${l.name.padEnd(nameW)}  ${adj}`);
    }

    printNextSteps([
      `show_user "${enriched.length} location${enriched.length === 1 ? '' : 's'} in world ${worldId}."`,
      `mention "Use chronicle add-location to create more."`,
    ]);
  } finally {
    store.close();
  }
}
