/**
 * MemoryService — episodic memory retrieval and storage.
 *
 * Each tick, after observation is built, we retrieve top-K memories relevant to
 * the current situation. Memories decay over time, are boosted by importance,
 * and ranked by recency × importance × crude similarity.
 *
 * Embedding-based similarity is optional (v0.3); for v0.1 we use keyword overlap.
 */

import type { Agent, AgentMemory, Observation } from '@chronicle/core';
import type { WorldStore } from '../store.js';

export class MemoryService {
  constructor(private store: WorldStore) {}

  async retrieveRelevant(agent: Agent, observation: Observation, k = 10): Promise<AgentMemory[]> {
    const all = await this.store.getMemoriesForAgent(agent.id, 200);
    if (all.length === 0) return [];

    const currentTick = observation.tick;
    const queryText = this.buildQueryText(observation);
    const queryTokens = tokenize(queryText);

    // Score every memory
    const scored = all.map((m) => ({
      memory: m,
      score: this.scoreMemory(m, currentTick, queryTokens),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((x) => x.memory);
  }

  async record(
    agentId: string,
    content: string,
    params: {
      tick: number;
      type: AgentMemory['memoryType'];
      importance?: number;
      relatedEventId?: number;
      aboutAgentId?: string;
    },
  ): Promise<number> {
    return this.store.addMemory({
      agentId,
      createdTick: params.tick,
      memoryType: params.type,
      content,
      importance: params.importance ?? 0.5,
      decay: 1.0,
      relatedEventId: params.relatedEventId ?? null,
      aboutAgentId: params.aboutAgentId ?? null,
      embedding: null,
      lastAccessedTick: null,
    });
  }

  // ============================================================
  // Scoring
  // ============================================================

  private scoreMemory(m: AgentMemory, currentTick: number, queryTokens: Set<string>): number {
    const age = currentTick - m.createdTick;
    const recency = Math.exp(-age / 50); // decay constant; half-life around 35 ticks
    const importance = m.importance;
    const similarity = this.similarity(queryTokens, tokenize(m.content));
    // Weighted sum. Recency and importance dominate; similarity is a tiebreaker.
    return 0.45 * recency + 0.35 * importance + 0.2 * similarity;
  }

  private similarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let overlap = 0;
    for (const t of a) if (b.has(t)) overlap++;
    return overlap / Math.max(a.size, b.size);
  }

  private buildQueryText(obs: Observation): string {
    const parts: string[] = [];
    if (obs.selfState.location) parts.push(obs.selfState.location);
    if (obs.selfState.mood) parts.push(obs.selfState.mood);
    for (const a of obs.nearby.agents) parts.push(a.name);
    for (const e of obs.recentEvents) parts.push(e.description);
    return parts.join(' ');
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2), // drop stopword-ish short tokens
  );
}
