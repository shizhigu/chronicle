/**
 * EventBus — in-process pub/sub for tick events.
 *
 * Used by Engine to emit events (tick_begin, action_completed, etc.)
 * and by CLI/Dashboard to subscribe for live display.
 *
 * Keep this single-process. For multi-process (Cloud), we'll add a Redis/NATS
 * adapter later without changing callers.
 */

export type BusEvent =
  | { type: 'tick_begin'; worldId: string; tick: number }
  | { type: 'tick_end'; worldId: string; tick: number; dramaScore: number; liveAgentCount: number }
  | { type: 'action_completed'; worldId: string; agentId: string; tool: string; isError: boolean }
  | { type: 'char_thinking'; worldId: string; agentId: string; delta: unknown }
  | { type: 'budget_exceeded'; worldId: string }
  | { type: 'god_intervention_applied'; worldId: string; tick: number; description: string }
  | {
      type: 'speech';
      worldId: string;
      tick: number;
      fromAgentId: string;
      toTarget: string;
      content: string;
      tone: string | null;
    }
  | { type: 'death'; worldId: string; tick: number; agentId: string; reason: string }
  | {
      type: 'proposal_adopted';
      worldId: string;
      proposalId: string;
      detail: string;
      effectResults: { ok: boolean; detail: string }[];
    }
  | { type: 'proposal_rejected'; worldId: string; proposalId: string; detail: string }
  | { type: 'proposal_expired'; worldId: string; proposalId: string; detail: string }
  | { type: 'proposal_withdrawn'; worldId: string; proposalId: string; detail: string };

export type Subscriber = (event: BusEvent) => void | Promise<void>;

export class EventBus {
  private subs = new Set<Subscriber>();

  subscribe(sub: Subscriber): () => void {
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }

  emit(event: BusEvent): void {
    for (const sub of this.subs) {
      try {
        const maybe = sub(event);
        if (maybe instanceof Promise) {
          maybe.catch((err) => console.error('[EventBus] subscriber error:', err));
        }
      } catch (err) {
        console.error('[EventBus] subscriber error:', err);
      }
    }
  }

  clear(): void {
    this.subs.clear();
  }
}
