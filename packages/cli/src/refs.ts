/**
 * Shared id-or-name resolution helpers for CC-facing commands.
 *
 * Every governance-lifecycle wrapper (add-member, remove-member,
 * dissolve-group, etc.) needs to accept either an entity id or a
 * case-insensitive name, and MUST error on ambiguity — a silent
 * first-match is invisible to CC and produces wrong-target actions
 * with no signal. edit-character + add-group already implement this
 * pattern inline; these helpers let the rest of the CLI share it.
 */

import type { Agent, Group } from '@chronicle/core';

export function resolveAgentRef(agents: Agent[], token: string, ctx: string): Agent {
  const byId = agents.find((a) => a.id === token);
  if (byId) return byId;
  const byName = agents.filter((a) => a.name.toLowerCase() === token.toLowerCase());
  if (byName.length > 1) {
    const ids = byName.map((a) => a.id).join(', ');
    throw new Error(
      `${ctx}: ambiguous agent — ${byName.length} agents named "${token}" (${ids}); pass the id instead`,
    );
  }
  if (byName.length === 0) {
    throw new Error(`${ctx}: no agent "${token}" in this world`);
  }
  return byName[0]!;
}

export function resolveGroupRef(groups: Group[], token: string, ctx: string): Group {
  const byId = groups.find((g) => g.id === token);
  if (byId) return byId;
  const byName = groups.filter((g) => g.name.toLowerCase() === token.toLowerCase());
  if (byName.length > 1) {
    const ids = byName.map((g) => g.id).join(', ');
    throw new Error(
      `${ctx}: ambiguous group — ${byName.length} groups named "${token}" (${ids}); pass the id instead`,
    );
  }
  if (byName.length === 0) {
    throw new Error(`${ctx}: no group "${token}" in this world`);
  }
  return byName[0]!;
}
