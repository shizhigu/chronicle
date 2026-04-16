/**
 * Stable exit codes — a public contract for agents & scripts.
 *
 * The CLI is explicitly designed to be driven by AI agents (see
 * NEXT_STEPS blocks) and shell scripts. Both need to branch on *why* a
 * command failed, not just that it did. Distinguishing "no provider
 * available" (transient — set a key and retry) from "world not found"
 * (permanent — typo or deleted) from "budget exceeded" (user decision
 * required) is the whole point.
 *
 * These numbers are **stable contract**. Do not renumber. New conditions
 * get new numbers appended; deprecated ones stay reserved with a
 * comment.
 *
 * Convention: 0 = success, 1 = generic/unexpected, ≥2 = specific kinds.
 * This matches the hermes-agent and pi-mono conventions and Unix norms
 * for "other meaningful exit codes live in 64-113 per sysexits.h" — we
 * deliberately stay in the 0-7 range to remain scriptable across both
 * CLI conventions without collision.
 */

export const ExitCode = {
  /** Command succeeded. */
  Ok: 0,

  /**
   * Generic / unexpected failure. Any uncaught error lands here — do NOT
   * return this when a more specific code applies.
   */
  Generic: 1,

  /**
   * Configuration or usage error. The user's environment is wrong in a
   * way we can name: missing defaultProvider/defaultModel, malformed
   * config.json, unknown provider id, invalid flags.
   * → Suggest `chronicle onboard` / `chronicle config --set ...`.
   */
  ConfigError: 2,

  /**
   * No usable LLM provider on this machine — no local server running
   * and no cloud key in env. Distinct from ConfigError because the fix
   * is environmental, not a config edit.
   * → Suggest starting a local server or exporting a key.
   */
  NoProvider: 3,

  /**
   * Requested resource doesn't exist: world id unknown, file path
   * missing, tick out of range.
   * → Suggest `chronicle list` or checking the path.
   */
  NotFound: 4,

  /**
   * Run stopped because a safety ceiling was hit: token budget, dollar
   * budget, per-world ceiling, agent-death blocker.
   * → User decision required; we don't auto-resume.
   */
  BudgetExceeded: 5,

  /**
   * Credential-store problem: auth.json malformed, refused write (disk
   * full / permissions), or the user asked for an auth action on a
   * provider that has no stored credential.
   * → Suggest `chronicle auth list` / `chronicle auth set ...`.
   */
  AuthError: 6,
} as const;

export type ExitCodeName = keyof typeof ExitCode;
export type ExitCodeValue = (typeof ExitCode)[ExitCodeName];

/**
 * Typed error that carries an exit code. Throw this anywhere in the CLI
 * and the top-level handler will exit with the right code.
 *
 * ```ts
 * throw new CliError('World chr_abc123 not found', ExitCode.NotFound);
 * ```
 */
export class CliError extends Error {
  constructor(
    message: string,
    readonly code: ExitCodeValue,
    readonly action?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/**
 * Classify an arbitrary error value into an exit code. CliError keeps
 * its declared code; everything else becomes `Generic`.
 */
export function classifyExitCode(err: unknown): ExitCodeValue {
  if (err instanceof CliError) return err.code;
  return ExitCode.Generic;
}
