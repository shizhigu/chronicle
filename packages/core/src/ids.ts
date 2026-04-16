/**
 * Short, collision-resistant IDs for worlds, agents, locations, etc.
 *
 * Format: `<prefix>_<6 chars>`
 * Example: chr_9k8m3n, agt_p4x7a2, loc_bea2ch
 */

import { customAlphabet } from 'nanoid';

// alphabet: 32 URL-safe chars (no confusing ones like 0/O, 1/l/I)
const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
const genShort = customAlphabet(alphabet, 6);

export function generateId(prefix: string): string {
  return `${prefix}_${genShort()}`;
}

export const IdPrefix = {
  world: 'chr',
  agent: 'agt',
  location: 'loc',
  resource: 'res',
  rule: 'rul',
  action: 'act',
  agreement: 'agr',
  memory: 'mem',
  intervention: 'iv',
  fork: 'frk',
  group: 'grp',
  authority: 'auth',
  proposal: 'prop',
} as const;

export function worldId(): string {
  return generateId(IdPrefix.world);
}
export function agentId(): string {
  return generateId(IdPrefix.agent);
}
export function locationId(): string {
  return generateId(IdPrefix.location);
}
export function resourceId(): string {
  return generateId(IdPrefix.resource);
}
export function ruleId(): string {
  return generateId(IdPrefix.rule);
}
export function actionId(): string {
  return generateId(IdPrefix.action);
}
export function actionSchemaId(): string {
  return generateId(IdPrefix.action);
}
export function agreementId(): string {
  return generateId(IdPrefix.agreement);
}
export function memoryId(): string {
  return generateId(IdPrefix.memory);
}
export function interventionId(): string {
  return generateId(IdPrefix.intervention);
}
export function forkId(): string {
  return generateId(IdPrefix.fork);
}
export function groupId(): string {
  return generateId(IdPrefix.group);
}
export function authorityId(): string {
  return generateId(IdPrefix.authority);
}
export function proposalId(): string {
  return generateId(IdPrefix.proposal);
}
