/**
 * chronicle add-group <worldId> --name "..." --procedure vote [flags...]
 *
 * Ergonomic wrapper over the `create_group` effect (ADR-0011 § 3b).
 * Members can be passed by id OR name — mirrors `edit-character`'s
 * resolution behavior. Ambiguous names (two "Carol"s) are an error
 * rather than a silent first-match, same philosophy as elsewhere.
 */

import type { Effect, ProcedureKind, VisibilityPolicy } from '@chronicle/core';
import { GodService, WorldStore, validateEffects } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  name: string;
  description: string;
  procedure: string;
  procedureConfig?: string;
  visibility?: string;
  members?: string;
  at?: string;
}

const VALID_PROCEDURES: readonly ProcedureKind[] = [
  'decree',
  'vote',
  'consensus',
  'lottery',
  'delegated',
];
const VALID_VISIBILITIES: readonly VisibilityPolicy[] = ['open', 'closed', 'opaque'];

export async function addGroupCommand(worldId: string, opts: Options): Promise<void> {
  const procedure = opts.procedure.toLowerCase() as ProcedureKind;
  if (!VALID_PROCEDURES.includes(procedure)) {
    throw new Error(
      `add-group: --procedure must be one of ${VALID_PROCEDURES.join('|')} (got "${opts.procedure}")`,
    );
  }

  const visibility = opts.visibility
    ? (opts.visibility.toLowerCase() as VisibilityPolicy)
    : undefined;
  if (visibility && !VALID_VISIBILITIES.includes(visibility)) {
    throw new Error(
      `add-group: --visibility must be one of ${VALID_VISIBILITIES.join('|')} (got "${opts.visibility}")`,
    );
  }

  let procedureConfig: Record<string, unknown> | undefined;
  if (opts.procedureConfig !== undefined) {
    try {
      const parsed = JSON.parse(opts.procedureConfig);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('expected a JSON object');
      }
      procedureConfig = parsed as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`add-group: --procedure-config is not a valid JSON object — ${msg}`);
    }
  }

  const store = await WorldStore.open(paths.db);
  try {
    const world = await store.loadWorld(worldId);

    // Resolve --members "a,b,c" where each entry is an id OR a name.
    // Ambiguous names error out (two agents sharing a display name
    // would otherwise silently pick the first match, which CC cannot
    // detect — same philosophy as `edit-character`).
    const memberTokens = opts.members
      ? opts.members
          .split(',')
          .map((m) => m.trim())
          .filter((m) => m.length > 0)
      : [];
    const initialMembers: string[] = [];
    if (memberTokens.length > 0) {
      const agents = await store.getLiveAgents(worldId);
      for (const token of memberTokens) {
        const byId = agents.find((a) => a.id === token);
        if (byId) {
          initialMembers.push(byId.id);
          continue;
        }
        const byName = agents.filter((a) => a.name.toLowerCase() === token.toLowerCase());
        if (byName.length > 1) {
          const ids = byName.map((a) => a.id).join(', ');
          throw new Error(
            `add-group: ambiguous member — ${byName.length} agents named "${token}" (${ids}); pass the id instead`,
          );
        }
        if (byName.length === 0) {
          throw new Error(`add-group: no agent "${token}" in world ${worldId}`);
        }
        initialMembers.push(byName[0]!.id);
      }
    }

    const effect: Effect = {
      kind: 'create_group',
      name: opts.name,
      description: opts.description,
      procedure,
      ...(procedureConfig ? { procedureConfig } : {}),
      ...(visibility ? { visibility } : {}),
      ...(initialMembers.length > 0 ? { initialMembers } : {}),
    };

    const validation = await validateEffects([effect], {
      store,
      world,
      tick: world.currentTick + 1,
    });
    if (validation) {
      throw new Error(humanizeAddGroupError(validation.reason));
    }

    const god = new GodService(store);
    const applyAt = opts.at ? Number.parseInt(opts.at, 10) : world.currentTick + 1;
    const id = await god.queue(world, `form group "${opts.name}" (${procedure})`, applyAt, [
      effect,
    ]);

    console.log(`✓ group "${opts.name}" queued for tick ${applyAt} (intervention #${id})`);
    console.log(`  procedure: ${procedure}, members: ${initialMembers.length}`);
    printNextSteps([
      `show_user "Group '${opts.name}' will form at tick ${applyAt}."`,
      `suggest_call "chronicle run ${worldId} --ticks 5 --live"`,
    ]);
  } finally {
    store.close();
  }
}

function humanizeAddGroupError(reason: string): string {
  if (reason.startsWith('duplicate_group_name:')) {
    const name = reason.slice('duplicate_group_name:'.length);
    return (
      `add-group: a group named "${name}" already exists in this world. ` +
      `Group names are case-insensitive; pick a different name. (${reason})`
    );
  }
  if (reason.startsWith('missing_member:')) {
    const id = reason.slice('missing_member:'.length);
    return `add-group: initial member "${id}" is not a live agent in this world. (${reason})`;
  }
  if (reason === 'empty_name') {
    return 'add-group: --name cannot be empty.';
  }
  return `add-group: ${reason}`;
}
