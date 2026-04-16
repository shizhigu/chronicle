/**
 * ObservationBuilder — computes what each agent perceives this tick.
 *
 * Observation = structured view of local state: self, nearby agents/resources,
 * recent events visible to this agent, relevant memories, active goals.
 *
 * Builds from DB each tick. Cacheable if agent didn't move and nothing changed.
 */

import type { Agent, Observation, World } from '@chronicle/core';
import type { WorldStore } from '../store.js';

export class ObservationBuilder {
  constructor(
    private store: WorldStore,
    private world: World,
  ) {}

  async build(agent: Agent, tick: number): Promise<Observation> {
    const [inventory, locationInfo, nearby, recent] = await Promise.all([
      this.getInventory(agent),
      this.getLocationInfo(agent),
      this.getNearbyAgents(agent),
      this.getRecentEventsVisibleTo(agent, tick),
    ]);

    return {
      agentId: agent.id,
      tick,
      selfState: {
        location: locationInfo?.name ?? null,
        mood: agent.mood,
        energy: agent.energy,
        health: agent.health,
        inventory,
      },
      nearby: {
        agents: nearby.map((a) => ({
          name: a.name,
          sprite: (a.traits['sprite'] as string) ?? 'default',
          mood: a.mood,
        })),
        resources: locationInfo?.resources ?? [],
        locations: locationInfo?.adjacent ?? [],
      },
      recentEvents: recent,
      currentGoals: [], // TODO: derive from agent.privateState or reflections
    };
  }

  private async getInventory(agent: Agent): Promise<{ type: string; quantity: number }[]> {
    const resources = await this.store.getResourcesOwnedBy(agent.id);
    return resources.map((r) => ({ type: r.type, quantity: r.quantity }));
  }

  private async getLocationInfo(agent: Agent): Promise<{
    name: string;
    resources: { type: string; quantity: number }[];
    adjacent: { name: string; adjacent: boolean }[];
  } | null> {
    if (!agent.locationId) return null;
    const [loc, resources, adjacentIds] = await Promise.all([
      this.store.getLocation(agent.locationId),
      this.store.getResourcesAtLocation(agent.locationId),
      this.store.getAdjacentLocations(agent.locationId),
    ]);
    const adjacent: { name: string; adjacent: boolean }[] = [];
    for (const id of adjacentIds) {
      try {
        const adjLoc = await this.store.getLocation(id);
        adjacent.push({ name: adjLoc.name, adjacent: true });
      } catch {
        /* ignore missing */
      }
    }
    return {
      name: loc.name,
      resources: resources.map((r) => ({ type: r.type, quantity: r.quantity })),
      adjacent,
    };
  }

  private async getNearbyAgents(agent: Agent): Promise<Agent[]> {
    if (!agent.locationId) return [];
    const all = await this.store.getLiveAgents(this.world.id);
    return all.filter((a) => a.id !== agent.id && a.locationId === agent.locationId);
  }

  private async getRecentEventsVisibleTo(
    agent: Agent,
    tick: number,
  ): Promise<{ tick: number; description: string }[]> {
    const windowSize = 5;
    const events = await this.store.getRecentEvents(this.world.id, Math.max(0, tick - windowSize));
    const filtered = events
      .filter((e) => e.visibleTo.length === 0 /* public */ || e.visibleTo.includes(agent.id))
      .slice(-10);
    return filtered.map((e) => ({
      tick: e.tick,
      description: this.describeEvent(e),
    }));
  }

  private describeEvent(event: {
    eventType: string;
    actorId: string | null;
    data: Record<string, unknown>;
  }): string {
    const actor = event.actorId ? `${event.actorId}` : 'the world';
    switch (event.eventType) {
      case 'action': {
        const a = event.data.action ?? 'acted';
        return `${actor} performed ${a}`;
      }
      case 'god_intervention': {
        return `Something happened: ${event.data.description ?? 'an unexpected event'}`;
      }
      case 'death': {
        return `${event.data.name ?? actor} died`;
      }
      case 'catalyst': {
        return String(event.data.description ?? 'a disturbance occurred');
      }
      default:
        return `[${event.eventType}]`;
    }
  }
}
