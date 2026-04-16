/**
 * CLI-wide error formatting.
 *
 * Separated from `index.ts` so tests can exercise it without booting the
 * whole commander tree. The goal is to keep user-facing error text short
 * and actionable — Zod dumps and stack traces belong behind a verbose
 * flag, not on the first line the user reads.
 */

/**
 * Human-readable one-liner for an error.
 *
 * Special case: `ZodError` instances get their multi-issue JSON turned
 * into prose ("rules[0].scope: Expected object, received string (+2 more)").
 * We duck-type the error rather than import zod here to avoid a transitive
 * dependency from the entry point.
 */
export function summariseError(err: unknown): string {
  if (err === null || err === undefined) return 'Unknown error';

  const maybeZod = err as {
    name?: string;
    issues?: Array<{ path?: unknown[]; message?: string }>;
  };
  if (maybeZod.name === 'ZodError' && Array.isArray(maybeZod.issues)) {
    const issues = maybeZod.issues.slice(0, 3);
    const parts = issues.map((i) => {
      const path = Array.isArray(i.path) && i.path.length > 0 ? i.path.join('.') : '<root>';
      return `${path}: ${i.message ?? 'invalid'}`;
    });
    const extra = maybeZod.issues.length - issues.length;
    const more = extra > 0 ? ` (+${extra} more)` : '';
    return `Schema validation failed — ${parts.join('; ')}${more}. This usually means the model returned a shape the compiler couldn't parse; retrying often helps on small models.`;
  }

  if (err instanceof Error) return err.message;
  return String(err);
}
