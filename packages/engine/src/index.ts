/**
 * @chronicle/engine — simulation engine exports.
 */

export { WorldStore } from './store.js';
export { Engine, type EngineOptions } from './engine.js';
export { RuleEnforcer } from './rules/enforcer.js';
export { EventBus, type BusEvent, type Subscriber } from './events/bus.js';
export { ObservationBuilder } from './perception/observation.js';
export {
  MemoryFileStore,
  DEFAULT_CHAR_LIMIT,
  ENTRY_DELIMITER,
  type MemoryFileStoreOpts,
  type MemoryOpResult,
} from './memory/file-store.js';
export { ReflectionService, type ReflectionDeps } from './memory/reflection.js';
export {
  applyEffects,
  validateEffects,
  isKnownEffectKind,
  INVIOLABLE_MARKER,
  type EffectContext,
  type EffectResult,
} from './governance/effects.js';
export {
  ProposalService,
  type ProposalSettleResult,
} from './governance/proposal-service.js';
export {
  ActivationService,
  type AgentActivation,
  type ActivationDecision,
} from './activation/service.js';
export { DramaDetector } from './narrative/drama.js';
export { CatalystInjector } from './narrative/catalyst.js';
export { GodService } from './god/service.js';
export { WebSocketBridge, type BridgeOpts } from './bridge/websocket.js';
export { WorldStateServer, type StateServerOpts } from './bridge/state-server.js';
export { DbEventRelay, type DbEventRelayOpts } from './bridge/db-event-relay.js';
export type { AgentRuntimeAdapter } from './engine.js';
export {
  evaluatePredicate,
  evaluatePredicateSafe,
  PredicateError,
  type PredicateContext,
} from './rules/predicate.js';
