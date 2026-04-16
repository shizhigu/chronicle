/**
 * chronicle grant-authority <worldId> --to-kind <agent|group|role> --to-ref <id> --powers '<json>'
 *
 * Ergonomic wrapper over the `grant_authority` effect (ADR-0011 § 3b).
 * `--powers` must be a JSON array of AuthorityPower objects — this is
 * the one place where JSON-on-CLI is unavoidable because the power
 * schema is an open-ended discriminated union. CC should have no
 * trouble composing it.
 */

import type { AuthorityHolderKind, AuthorityPower, Effect } from '@chronicle/core';
import { GodService, WorldStore, validateEffects } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  toKind: string;
  toRef: string;
  powers: string;
  expiresTick?: string;
  at?: string;
}

const VALID_KINDS: readonly AuthorityHolderKind[] = ['agent', 'group', 'role'];

export async function grantAuthorityCommand(worldId: string, opts: Options): Promise<void> {
  const holderKind = opts.toKind.toLowerCase() as AuthorityHolderKind;
  if (!VALID_KINDS.includes(holderKind)) {
    throw new Error(
      `grant-authority: --to-kind must be one of ${VALID_KINDS.join('|')} (got "${opts.toKind}")`,
    );
  }

  let powers: AuthorityPower[];
  try {
    const parsed = JSON.parse(opts.powers);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('expected a non-empty JSON array');
    }
    powers = parsed as AuthorityPower[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `grant-authority: --powers must be a non-empty JSON array of AuthorityPower — ${msg}`,
    );
  }

  const expiresTick = opts.expiresTick ? Number.parseInt(opts.expiresTick, 10) : undefined;

  const effect: Effect = {
    kind: 'grant_authority',
    holderKind,
    holderRef: opts.toRef,
    powers,
    ...(expiresTick !== undefined ? { expiresTick } : {}),
  };

  const store = await WorldStore.open(paths.db);
  try {
    const world = await store.loadWorld(worldId);
    const validation = await validateEffects([effect], {
      store,
      world,
      tick: world.currentTick + 1,
    });
    if (validation) {
      throw new Error(humanizeGrantAuthError(validation.reason));
    }

    const god = new GodService(store);
    const applyAt = opts.at ? Number.parseInt(opts.at, 10) : world.currentTick + 1;
    const id = await god.queue(world, `grant authority to ${holderKind}:${opts.toRef}`, applyAt, [
      effect,
    ]);

    console.log(`✓ authority grant queued for tick ${applyAt} (intervention #${id})`);
    console.log(`  holder: ${holderKind}:${opts.toRef}, powers: ${powers.length}`);
    printNextSteps([
      `show_user "Authority grant to ${holderKind}:${opts.toRef} will land at tick ${applyAt}."`,
      `suggest_call "chronicle run ${worldId} --ticks 5 --live"`,
    ]);
  } finally {
    store.close();
  }
}

function humanizeGrantAuthError(reason: string): string {
  if (reason.startsWith('bad_holder:')) {
    const ref = reason.slice('bad_holder:'.length);
    return (
      `grant-authority: holder "${ref}" is not an entity in this world ` +
      `— check the id, or use a different --to-kind. (${reason})`
    );
  }
  if (reason === 'no_powers_specified') {
    return 'grant-authority: --powers array is empty. Provide at least one AuthorityPower.';
  }
  if (reason.startsWith('malformed_role_ref:')) {
    return (
      `grant-authority: --to-kind role requires --to-ref of shape "groupId#roleName" ` +
      `(${reason})`
    );
  }
  return `grant-authority: ${reason}`;
}
