/**
 * chronicle list-agents <worldId> [--json] [--include-dead]
 *
 * Read-only enumeration of agents. Shows name + location + mood +
 * energy/health + alive status. `--include-dead` surfaces dead agents
 * too (useful for narrative post-mortem; deadTick shown as extra column).
 */

import { WorldStore } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  json?: boolean;
  includeDead?: boolean;
}

export async function listAgentsCommand(worldId: string, opts: Options): Promise<void> {
  const store = await WorldStore.open(paths.db);
  try {
    await store.loadWorld(worldId);

    const agents = opts.includeDead
      ? await store.getAllAgents(worldId)
      : await store.getLiveAgents(worldId);

    // Resolve location names once so the table is readable.
    const locations = await store.getLocationsForWorld(worldId);
    const locName = new Map(locations.map((l) => [l.id, l.name] as const));

    const rows = agents.map((a) => ({
      id: a.id,
      name: a.name,
      location: a.locationId ? (locName.get(a.locationId) ?? a.locationId) : '(unplaced)',
      mood: a.mood ?? '-',
      energy: Math.round(a.energy),
      health: Math.round(a.health),
      alive: a.alive,
      deathTick: a.deathTick,
    }));

    if (opts.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    if (rows.length === 0) {
      console.log('(no agents)');
      printNextSteps([
        `show_user "No agents in this world${opts.includeDead ? ' (dead or alive)' : ''}."`,
      ]);
      return;
    }

    const idW = Math.max(4, ...rows.map((r) => r.id.length));
    const nameW = Math.max(4, ...rows.map((r) => r.name.length));
    const locW = Math.max(3, ...rows.map((r) => r.location.length));
    const moodW = Math.max(4, ...rows.map((r) => r.mood.length));

    const statusCol = opts.includeDead ? 'STATUS' : '';
    const header =
      `${'ID'.padEnd(idW)}  ${'NAME'.padEnd(nameW)}  ${'LOC'.padEnd(locW)}  ` +
      `${'MOOD'.padEnd(moodW)}  E   H  ${statusCol}`;
    console.log(header);
    console.log('-'.repeat(header.length));
    for (const r of rows) {
      const status = opts.includeDead ? (r.alive ? 'alive' : `dead@${r.deathTick ?? '?'}`) : '';
      console.log(
        `${r.id.padEnd(idW)}  ${r.name.padEnd(nameW)}  ${r.location.padEnd(locW)}  ` +
          `${r.mood.padEnd(moodW)}  ${String(r.energy).padStart(3)} ${String(r.health).padStart(3)}  ${status}`,
      );
    }

    printNextSteps([
      `show_user "${rows.length} agent${rows.length === 1 ? '' : 's'} in world ${worldId}${opts.includeDead ? ' (incl. dead)' : ''}."`,
      `mention "Use chronicle edit-character to modify persona/mood, or dashboard to watch live."`,
    ]);
  } finally {
    store.close();
  }
}
