/**
 * DbEventRelay — bridges cross-process event streams via the events table.
 *
 * Problem: `chronicle run` and `chronicle dashboard` are separate
 * processes, each with their own in-memory `EventBus`. Events emitted
 * inside `run` (tick_begin / tick_end / action_completed / speech /
 * char_thinking) never reach the dashboard's WS bridge — its bus is
 * disjoint. The user sees a dead UI while the simulation is roaring
 * along in another shell.
 *
 * Fix: poll the events table. Chronicle is already event-sourced
 * (ADR-0003), so every meaningful tick change — actions, god
 * interventions, proposals, dormancy tracers — lands in SQLite.
 * This class watches `SELECT * FROM events WHERE id > lastSeen`
 * every ~500ms, translates new rows into `BusEvent` shapes the
 * dashboard UI already understands, and emits them on the target
 * bus, which the WebSocketBridge forwards to the browser.
 *
 * Why not something fancier? A proper pub/sub solution (NATS /
 * Redis / named pipes) is warranted once we run ticks at more than
 * a few Hz. For the current scale — one tick per multi-second LLM
 * round-trip — a 500ms DB poll is within one tick of live and
 * pulls zero rows when the world is idle.
 *
 * Tick boundaries are inferred: when the first event of tick T
 * arrives, emit `tick_begin(T)` (and `tick_end(T-1)` if needed)
 * before the event itself. Those two event kinds are NOT persisted
 * to the DB — the engine emits them only on the in-process bus —
 * so they have to be synthesized here.
 */

import type { Event, EventType } from '@chronicle/core';
import type { BusEvent, EventBus } from '../events/bus.js';
import type { WorldStore } from '../store.js';

export interface DbEventRelayOpts {
  /** Source of truth. */
  store: WorldStore;
  /** Re-emit target — WebSocketBridge is subscribed here. */
  bus: EventBus;
  /** World to watch. */
  worldId: string;
  /**
   * Poll interval. Default 500ms — fast enough that the UI feels
   * live against a few-Hz tick cadence, slow enough that an idle
   * world doesn't hammer the DB.
   */
  pollIntervalMs?: number;
  /**
   * Starting point. If omitted, relay starts from the current
   * highest event id (i.e. "from now on"). Set to 0 to replay
   * every historical event for the world — useful for bootstrapping
   * a late-joining UI.
   */
  fromEventId?: number;
  /**
   * Starting tick (default: world's `currentTick`). Used only for the
   * tick-boundary synthesis so we don't emit `tick_end(-1)` on startup.
   */
  fromTick?: number;
}

export class DbEventRelay {
  private timer?: ReturnType<typeof setInterval>;
  private lastEventId = 0;
  private currentTick = -1;
  private running = false;
  private polling = false;

  constructor(private opts: DbEventRelayOpts) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.currentTick = this.opts.fromTick ?? -1;

    if (this.opts.fromEventId !== undefined) {
      this.lastEventId = this.opts.fromEventId;
    } else {
      // Default: start from the current high-water mark so we don't
      // replay all historical events on every dashboard restart.
      this.lastEventId = await this.peekLatestEventId();
    }

    const interval = this.opts.pollIntervalMs ?? 500;
    this.timer = setInterval(() => {
      // Overlap guard — if the DB is slow the previous poll might
      // still be running. Skipping this tick is fine; the next one
      // will pick up the backlog.
      if (this.polling) return;
      this.poll().catch((err) => {
        console.error('[DbEventRelay] poll failed:', err);
      });
    }, interval);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    // Emit a final tick_end for any tick we were mid-stream on so the
    // UI's tick counter isn't left pointing at a half-rendered tick.
    if (this.currentTick >= 0) {
      this.opts.bus.emit({
        type: 'tick_end',
        worldId: this.opts.worldId,
        tick: this.currentTick,
        dramaScore: 0,
        liveAgentCount: 0,
      });
    }
  }

  /** Exposed for tests. Walks once. */
  async poll(): Promise<void> {
    this.polling = true;
    try {
      const rows = await this.opts.store.getEventsAfter(this.opts.worldId, this.lastEventId);
      if (rows.length === 0) return;
      for (const ev of rows) {
        this.syncTickBoundary(ev.tick);
        const translated = this.translate(ev);
        for (const t of translated) this.opts.bus.emit(t);
        this.lastEventId = Math.max(this.lastEventId, ev.id);
      }
    } finally {
      this.polling = false;
    }
  }

  /**
   * Emit tick_end(prev) + tick_begin(next) as the event stream crosses
   * tick boundaries. Keeps UIs that track `latestTick` from
   * tick_begin/tick_end (the pre-existing shape) working against
   * a DB-polled feed.
   */
  private syncTickBoundary(evTick: number): void {
    if (this.currentTick < 0) {
      // First event we've seen. Bootstrap directly into this tick.
      this.opts.bus.emit({
        type: 'tick_begin',
        worldId: this.opts.worldId,
        tick: evTick,
      });
      this.currentTick = evTick;
      return;
    }
    if (evTick === this.currentTick) return;
    if (evTick < this.currentTick) {
      // Forks or manual rewinds. We don't emit synthetic boundaries
      // backwards; the UI can handle out-of-order ticks, and
      // synthesising tick_begin(-N) would be misleading.
      return;
    }
    // Closing the previous tick. Drama + live count are unknown at
    // relay time — emit zeros; the dashboard's plain tick counter
    // only reads `tick`.
    this.opts.bus.emit({
      type: 'tick_end',
      worldId: this.opts.worldId,
      tick: this.currentTick,
      dramaScore: 0,
      liveAgentCount: 0,
    });
    // Mind any skipped ticks — if the run went from 5 → 8, the
    // in-between ticks had no persisted events at all (dormant
    // + silent + action all write rows, so this is rare). Skip
    // synthesising begin/end for them — the UI tolerates gaps.
    this.opts.bus.emit({
      type: 'tick_begin',
      worldId: this.opts.worldId,
      tick: evTick,
    });
    this.currentTick = evTick;
  }

  private async peekLatestEventId(): Promise<number> {
    const rows = await this.opts.store.getEventsAfter(this.opts.worldId, 0);
    if (rows.length === 0) return 0;
    return rows[rows.length - 1]!.id;
  }

  /** Map a DB event row to zero-or-more BusEvents the UI expects. */
  private translate(ev: Event): BusEvent[] {
    const t = ev.eventType as EventType;
    switch (t) {
      case 'action': {
        const data = ev.data as { action?: string; args?: Record<string, unknown> };
        const out: BusEvent[] = [
          {
            type: 'action_completed',
            worldId: ev.worldId,
            agentId: ev.actorId ?? 'unknown',
            tool: data.action ?? 'unknown',
            isError: false,
          },
        ];
        // Surface speak specifically as a rich `speech` event so the
        // UI's speech-bubble rendering path picks it up. Everything
        // else stays a generic action_completed.
        if (data.action === 'speak') {
          const args = (data.args ?? {}) as {
            to?: string;
            content?: string;
            tone?: string | null;
          };
          if (args.content) {
            out.push({
              type: 'speech',
              worldId: ev.worldId,
              tick: ev.tick,
              fromAgentId: ev.actorId ?? 'unknown',
              toTarget: args.to ?? 'all',
              content: args.content,
              tone: args.tone ?? null,
            });
          }
        }
        return out;
      }
      case 'god_intervention':
        return [
          {
            type: 'god_intervention_applied',
            worldId: ev.worldId,
            tick: ev.tick,
            description: (ev.data as { description?: string }).description ?? 'god intervention',
          },
        ];
      case 'death':
        return [
          {
            type: 'death',
            worldId: ev.worldId,
            tick: ev.tick,
            agentId: ev.actorId ?? 'unknown',
            reason: (ev.data as { reason?: string }).reason ?? 'unknown',
          },
        ];
      case 'catalyst': {
        const data = ev.data as { description?: string; atmosphereTag?: string };
        return [
          {
            type: 'catalyst',
            worldId: ev.worldId,
            tick: ev.tick,
            description: data.description ?? 'something shifted',
            atmosphereTag: data.atmosphereTag,
          },
        ];
      }
      case 'budget_exceeded':
        return [{ type: 'budget_exceeded', worldId: ev.worldId }];
      case 'proposal_adopted':
      case 'proposal_rejected':
      case 'proposal_expired':
      case 'proposal_withdrawn': {
        const data = ev.data as { proposalId?: string; detail?: string };
        const proposalId = data.proposalId ?? 'unknown';
        const detail = data.detail ?? '';
        if (t === 'proposal_adopted') {
          return [
            {
              type: 'proposal_adopted',
              worldId: ev.worldId,
              proposalId,
              detail,
              effectResults: [],
            },
          ];
        }
        return [{ type: t, worldId: ev.worldId, proposalId, detail }];
      }
      // These types have no UI-side representation yet but we
      // don't want to emit garbage. Drop silently.
      case 'tick_begin':
      case 'tick_end':
      case 'agent_reflection':
      case 'rule_violation':
      case 'birth':
      case 'proposal_opened':
      case 'vote_cast':
      case 'agent_dormant':
      case 'agent_silent':
        return [];
      // `action` is handled above (with the speak→speech split);
      // this branch is unreachable but TS needs it for exhaustiveness.
      default: {
        // Exhaustiveness check — if someone adds a new EventType and
        // forgets to handle it here, TS will complain.
        const _: never = t;
        return [];
      }
    }
  }
}
