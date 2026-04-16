/**
 * WorldStateServer — HTTP JSON endpoint for dashboard SSR / initial fetch.
 *
 * Run alongside WebSocketBridge. The dashboard fetches `/api/worlds/:id/state`
 * on mount to hydrate locations + agent roster, then subscribes to the WS
 * bridge for live events.
 *
 * Runtime: Bun. CORS-open by default (dashboard runs on a different port
 * in dev); tighten for hosted deploys.
 */

import type { Server } from 'bun';
import type { WorldStore } from '../store.js';

type AnyServer = Server<unknown>;

export interface StateServerOpts {
  port: number;
  /** Optional allowlist for CORS — defaults to "*". */
  corsOrigin?: string;
}

export class WorldStateServer {
  private server?: AnyServer;

  constructor(
    private store: WorldStore,
    private opts: StateServerOpts,
  ) {}

  start(): void {
    const cors = this.opts.corsOrigin ?? '*';

    this.server = Bun.serve({
      port: this.opts.port,
      fetch: async (req) => {
        const url = new URL(req.url);

        if (req.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: corsHeaders(cors),
          });
        }

        // /api/worlds                       → list worlds
        // /api/worlds/:id/state             → full initial state
        // /api/worlds/:id/events?since=N    → event window (replay tail)
        const m = url.pathname.match(/^\/api\/worlds(?:\/([a-z0-9_-]+)(?:\/(state|events))?)?$/);
        if (!m) {
          return new Response('not found', { status: 404, headers: corsHeaders(cors) });
        }
        const [, id, endpoint] = m;

        try {
          if (!id) {
            const worlds = await this.store.listWorlds();
            return json(worlds, cors);
          }
          if (endpoint === 'state') {
            return json(await this.buildState(id), cors);
          }
          if (endpoint === 'events') {
            const since = Number(url.searchParams.get('since') ?? '0');
            const events = await this.store.getRecentEvents(id, since);
            return json(events, cors);
          }
          // Default: world metadata only
          const world = await this.store.loadWorld(id);
          return json(world, cors);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: msg }), {
            status: 404,
            headers: { ...corsHeaders(cors), 'content-type': 'application/json' },
          });
        }
      },
    });
  }

  stop(): void {
    this.server?.stop(true);
    this.server = undefined;
  }

  /** Build the initial-state payload the dashboard canvas hydrates from. */
  private async buildState(worldId: string): Promise<{
    world: unknown;
    locations: unknown;
    agents: unknown;
  }> {
    const [world, locations, agents] = await Promise.all([
      this.store.loadWorld(worldId),
      this.store.getLocationsForWorld(worldId),
      this.store.getLiveAgents(worldId),
    ]);
    return {
      world: {
        id: world.id,
        name: world.name,
        currentTick: world.currentTick,
        status: world.status,
        atmosphere: world.config.atmosphere,
        atmosphereTag: world.config.atmosphereTag,
      },
      locations: locations.map((l) => ({
        id: l.id,
        name: l.name,
        x: l.x,
        y: l.y,
        parentId: l.parentId,
        affordances: l.affordances,
      })),
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        locationId: a.locationId,
        mood: a.mood,
        energy: a.energy,
        health: a.health,
      })),
    };
  }
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

function json(body: unknown, cors: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...corsHeaders(cors),
      'content-type': 'application/json',
    },
  });
}
