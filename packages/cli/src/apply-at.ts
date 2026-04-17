/**
 * Shared `--at <tick>` parser for every command that queues a future
 * god intervention (intervene, apply-effect, edit-character, add-rule,
 * remove-rule, add-location, add-group, add-member, remove-member,
 * dissolve-group, grant-authority).
 *
 * Previously each command inlined
 *   `opts.at ? Number.parseInt(opts.at, 10) : world.currentTick + 1`
 * which silently accepted:
 *   - NaN (`--at foo`) → queued for tick NaN, intervention never fires
 *   - negative numbers (`--at -5`) → same
 *   - past ticks (`--at 5` when world.currentTick=20) → fires on the
 *     NEXT tick (21) rather than the one the user asked for,
 *     because the engine's getPendingInterventions filter is
 *     `applyAtTick <= tick` and anything already past qualifies
 *
 * Validation: `--at` must parse to a finite integer strictly greater
 * than `currentTick` (i.e. you can only queue for a FUTURE tick,
 * never replay into the past).
 */

import { CliError, ExitCode } from './exit-codes.js';

export function resolveApplyAt(opts: { at?: string }, currentTick: number): number {
  if (opts.at === undefined) return currentTick + 1;
  const raw = opts.at.trim();
  if (raw === '') return currentTick + 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new CliError(`--at must be an integer tick number; got '${opts.at}'`, ExitCode.Generic);
  }
  if (parsed <= currentTick) {
    throw new CliError(
      `--at must be > currentTick (${currentTick}); got ${parsed}. God interventions cannot be queued retroactively — chronicle run past the target tick, then use chronicle fork to branch at an earlier point.`,
      ExitCode.Generic,
    );
  }
  return parsed;
}
