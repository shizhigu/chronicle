/**
 * @chronicle/engine — simulation engine exports.
 */

export { WorldStore } from './store.js';
export { Engine, type EngineOptions } from './engine.js';
export { RuleEnforcer } from './rules/enforcer.js';
export { EventBus, type BusEvent, type Subscriber } from './events/bus.js';
export { ObservationBuilder } from './perception/observation.js';
export { MemoryService } from './memory/service.js';
export { ReflectionService, type ReflectionDeps } from './memory/reflection.js';
export { DramaDetector } from './narrative/drama.js';
export { CatalystInjector } from './narrative/catalyst.js';
export { GodService } from './god/service.js';
export { WebSocketBridge, type BridgeOpts } from './bridge/websocket.js';
export { WorldStateServer, type StateServerOpts } from './bridge/state-server.js';
export type { AgentRuntimeAdapter } from './engine.js';
export {
  evaluatePredicate,
  evaluatePredicateSafe,
  PredicateError,
  type PredicateContext,
} from './rules/predicate.js';
