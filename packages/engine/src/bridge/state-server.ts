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

import { redactValue } from '@chronicle/core';
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

        // /api/worlds                         → list worlds
        // /api/worlds/:id                     → world metadata
        // /api/worlds/:id/state               → full initial state
        // /api/worlds/:id/events?since=N      → event window (replay tail)
        // /api/worlds/:id/politics            → ADR-0009 snapshot: groups,
        //                                       memberships, roles, authorities,
        //                                       pending proposals with tallies
        const m = url.pathname.match(
          /^\/api\/worlds(?:\/([a-z0-9_-]+)(?:\/(state|events|politics))?)?$/,
        );
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
          if (endpoint === 'politics') {
            return json(await this.buildPoliticalSnapshot(id), cors);
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

  /**
   * Political snapshot (ADR-0009, ADR-0010).
   *
   * One shot of everything the dashboard needs to render a political
   * map: which groups exist, who belongs to them, who holds roles,
   * which authorities are in force, and which proposals are open. The
   * dashboard loads this on mount and then subscribes to the WS bridge
   * for event-driven updates (proposal_opened, vote_cast,
   * proposal_adopted, agent_dormant, etc.).
   *
   * Shape is kept flat and explicit — no embedded recursion — so the
   * frontend can render without re-joining. Vote tallies are
   * pre-computed here rather than in the client because the math is
   * procedure-agnostic and the server already has the data.
   */
  private async buildPoliticalSnapshot(worldId: string): Promise<{
    world: { id: string; currentTick: number };
    groups: Array<{
      id: string;
      name: string;
      description: string;
      procedureKind: string;
      procedureConfig: Record<string, unknown>;
      visibilityPolicy: string;
      foundedTick: number;
      dissolvedTick: number | null;
      memberIds: string[];
      roles: Array<{
        roleName: string;
        holderAgentId: string | null;
        votingWeight: number;
      }>;
    }>;
    authorities: Array<{
      id: string;
      holderKind: string;
      holderRef: string;
      powers: unknown[];
      grantedTick: number;
      expiresTick: number | null;
    }>;
    pendingProposals: Array<{
      id: string;
      title: string;
      sponsorAgentId: string;
      targetGroupId: string;
      openedTick: number;
      deadline: unknown;
      effectCount: number;
      tally: { for: number; against: number; abstain: number; totalWeight: number };
    }>;
  }> {
    const world = await this.store.loadWorld(worldId);

    // Active groups + all the stuff attached to each. We include
    // dissolved groups later if needed; for now keep the payload lean.
    const groups = await this.store.getGroupsForWorld(worldId);

    const groupRows = await Promise.all(
      groups.map(async (g) => {
        const [memberships, roles] = await Promise.all([
          this.store.getActiveMembershipsForGroup(g.id),
          this.store.getRolesForGroup(g.id),
        ]);
        return {
          id: g.id,
          name: g.name,
          description: g.description,
          procedureKind: g.procedureKind,
          procedureConfig: g.procedureConfig,
          visibilityPolicy: g.visibilityPolicy,
          foundedTick: g.foundedTick,
          dissolvedTick: g.dissolvedTick,
          memberIds: memberships.map((m) => m.agentId),
          roles: roles.map((r) => ({
            roleName: r.roleName,
            holderAgentId: r.holderAgentId,
            votingWeight: r.votingWeight,
          })),
        };
      }),
    );

    const authorities = await this.store.getActiveAuthoritiesForWorld(
      worldId,
      world.currentTick + 1,
    );

    // Filter out proposals whose target group has visibilityPolicy='opaque'
    // — non-members should not even know such a group exists, let alone
    // its pending business. `closed` groups DO show in the snapshot (the
    // group's existence is public) but their vote-level detail is already
    // visible only via messaging visibility; we keep the proposal
    // metadata since a dashboard may show "1 pending proposal (votes
    // hidden)". If a stricter policy is desired later, filter by `closed`
    // here too.
    const opaqueGroupIds = new Set(
      groups.filter((g) => g.visibilityPolicy === 'opaque').map((g) => g.id),
    );
    const pending = (await this.store.getPendingProposals(worldId)).filter(
      (p) => !opaqueGroupIds.has(p.targetGroupId),
    );
    const proposalRows = await Promise.all(
      pending.map(async (p) => {
        const votes = await this.store.getVotesForProposal(p.id);
        // All three stances accumulate WEIGHT (not raw count) so a
        // client can compare them on the same scale. A member with
        // votingWeight:3 who abstains contributes 3 to `abstain`.
        //
        // `totalWeight` is deliberately only for+against — the
        // decisive-vote denominator for ratio math like
        // `for / totalWeight >= threshold`. Abstentions are tracked
        // separately so clients can compute turnout as
        // `(for + against + abstain) / eligibleWeight`.
        const forWeight = votes.filter((v) => v.stance === 'for').reduce((s, v) => s + v.weight, 0);
        const againstWeight = votes
          .filter((v) => v.stance === 'against')
          .reduce((s, v) => s + v.weight, 0);
        const abstainWeight = votes
          .filter((v) => v.stance === 'abstain')
          .reduce((s, v) => s + v.weight, 0);
        return {
          id: p.id,
          title: p.title,
          sponsorAgentId: p.sponsorAgentId,
          targetGroupId: p.targetGroupId,
          openedTick: p.openedTick,
          deadline: p.deadline,
          effectCount: p.effects.length,
          tally: {
            for: forWeight,
            against: againstWeight,
            abstain: abstainWeight,
            totalWeight: forWeight + againstWeight,
          },
        };
      }),
    );

    return {
      world: { id: world.id, currentTick: world.currentTick },
      groups: groupRows,
      authorities: authorities.map((a) => ({
        id: a.id,
        holderKind: a.holderKind,
        holderRef: a.holderRef,
        powers: a.powers,
        grantedTick: a.grantedTick,
        expiresTick: a.expiresTick,
      })),
      pendingProposals: proposalRows,
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
  // Deep-redact before stringify. See ADR-0012 — state-server is a
  // transport boundary and its JSON can feed straight into a browser
  // dev-tools pane. Storage underneath is untouched.
  const safe = redactValue(body);
  return new Response(JSON.stringify(safe), {
    status: 200,
    headers: {
      ...corsHeaders(cors),
      'content-type': 'application/json',
    },
  });
}
