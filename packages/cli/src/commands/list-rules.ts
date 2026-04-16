/**
 * chronicle list-rules <worldId> [--json]
 *
 * Read-only enumeration of active rules. Unlike `add-rule` /
 * `remove-rule`, this does NOT go through the effect pipeline —
 * there's nothing to mutate. It's a direct store read formatted for
 * human inspection (default) or for CC to parse (`--json`).
 *
 * Output contract:
 *   - Plain mode prints a fixed-width table. Always includes tier,
 *     scope, short id, and a truncated description.
 *   - --json prints one JSON array on stdout, suitable for piping
 *     into downstream tools. No NEXT_STEPS block in json mode (the
 *     consumer is machine-driven and won't look for one).
 */

import { WorldStore } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  json?: boolean;
}

export async function listRulesCommand(worldId: string, opts: Options): Promise<void> {
  const store = await WorldStore.open(paths.db);
  try {
    // loadWorld throws a clean error if the id is bogus — let it
    // propagate so the CLI top-level error handler surfaces it.
    await store.loadWorld(worldId);
    const rules = await store.getActiveRules(worldId);

    if (opts.json) {
      console.log(JSON.stringify(rules, null, 2));
      return;
    }

    if (rules.length === 0) {
      console.log('(no active rules)');
      printNextSteps([
        `show_user "No active rules in this world yet."`,
        `suggest_call "chronicle add-rule ${worldId} --description '...' --tier hard --check '...'"`,
      ]);
      return;
    }

    const rows = rules.map((r) => ({
      id: r.id,
      tier: r.tier,
      scope:
        r.scopeKind && r.scopeKind !== 'world' ? `${r.scopeKind}:${r.scopeRef ?? '?'}` : 'world',
      description: r.description,
    }));

    // Compute column widths once — small N (rules rarely exceed 50).
    const idW = Math.max(4, ...rows.map((r) => r.id.length));
    const tierW = Math.max(4, ...rows.map((r) => r.tier.length));
    const scopeW = Math.max(5, ...rows.map((r) => r.scope.length));

    // Header row: three fixed-width columns + DESCRIPTION (variable).
    // Separator mirrors header length: id + 2 + tier + 2 + scope + 2 + "DESCRIPTION"(11).
    console.log(
      `${'ID'.padEnd(idW)}  ${'TIER'.padEnd(tierW)}  ${'SCOPE'.padEnd(scopeW)}  DESCRIPTION`,
    );
    console.log('-'.repeat(idW + 2 + tierW + 2 + scopeW + 2 + 11));
    for (const r of rows) {
      const desc = r.description.length <= 60 ? r.description : `${r.description.slice(0, 57)}...`;
      console.log(
        `${r.id.padEnd(idW)}  ${r.tier.padEnd(tierW)}  ${r.scope.padEnd(scopeW)}  ${desc}`,
      );
    }

    printNextSteps([
      `show_user "${rules.length} active rule${rules.length === 1 ? '' : 's'} in world ${worldId}."`,
      `mention "Use chronicle remove-rule to repeal one, or chronicle add-rule to add another."`,
    ]);
  } finally {
    store.close();
  }
}
