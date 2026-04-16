/**
 * @chronicle/core — shared types and utilities.
 */

export * from './types.js';
export * from './ids.js';
export * from './rng.js';
export * from './providers.js';
export { redact, redactValue, REDACTION_ENABLED } from './redact.js';
export {
  classifyError,
  retryWithBackoff,
  type ClassifiedError,
  type FailureKind,
  type RetryOptions,
} from './resilience.js';
export {
  CredentialPool,
  DEFAULT_COOLDOWN_MS,
  type PoolKey,
  type PoolStrategy,
  type KeyStatus,
  type KeySnapshot,
} from './credential-pool.js';
