/**
 * ReflectionService — periodic LLM-driven summary per agent.
 *
 * Every `reflectionFrequency` ticks, every live agent reflects: it writes
 * a concise summary of the last chapter from its own POV, which then
 * lands as a new entry in its memory.md file. Because the memory file
 * is injected into the system prompt at session start, reflections
 * written now will color every future turn's prompt.
 *
 * Reflection is where you'd point a stronger model if you want better
 * long-horizon coherence (per-turn can stay on a cheaper model). No
 * provider is privileged — the caller passes whatever they configured.
 */

import type { Agent, World } from '@chronicle/core';
import type { MemoryFileStore } from './file-store.js';

export interface ReflectionDeps {
  getAgentInstance: (agent: Agent) => {
    reflect: (
      prompt: string,
      modelOverride?: { provider: string; modelId: string },
    ) => Promise<string>;
  } | null;
  /**
   * Model used for the reflection pass. Pass whatever the user configured
   * — any provider pi-agent supports (local or cloud) is valid here.
   */
  reflectionModel: { provider: string; modelId: string };
}

export class ReflectionService {
  constructor(
    private world: World,
    private memory: MemoryFileStore,
    private deps: ReflectionDeps,
  ) {}

  async triggerFor(agents: Agent[], tick: number): Promise<void> {
    await Promise.all(
      agents.map((a) =>
        this.reflectOne(a, tick).catch((err) => {
          console.error(`[Reflection] failed for ${a.name}:`, err);
        }),
      ),
    );
  }

  private async reflectOne(agent: Agent, _tick: number): Promise<void> {
    const instance = this.deps.getAgentInstance(agent);
    if (!instance) return;

    const prompt = `REFLECTION TIME.
Look back over what's happened in this world since your last reflection.

Write a concise reflection (under 200 words) covering:
1. The 2-3 most important events from your perspective
2. How your relationships with others have shifted
3. Your current priorities or fears
4. One belief or conclusion you've updated

This becomes a lasting memory for you. Be honest and in-character.`;

    const reflection = await instance.reflect(prompt, this.deps.reflectionModel);
    const trimmed = reflection.trim();
    if (!trimmed) return;

    // Write into the character's durable memory file. On char-limit
    // overflow we swallow the error — the agent had a chance to curate
    // its memory earlier; failing the reflection would be worse than
    // dropping a single bloated summary.
    const result = await this.memory.add(this.world.id, agent.id, trimmed);
    if (!result.ok) {
      console.warn(`[Reflection] could not store reflection for ${agent.name}: ${result.detail}`);
    }
  }
}
