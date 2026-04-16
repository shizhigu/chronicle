/**
 * ReflectionService — periodic LLM-driven summary + belief update per agent.
 *
 * Every `reflectionFrequency` ticks, every live agent reflects. The reflection
 * is stored as a high-importance memory so it surfaces in future observations.
 *
 * This is where we spend Sonnet/GPT-5 tokens. Haiku for routine, Sonnet here.
 */

import type { Agent } from '@chronicle/core';
import type { WorldStore } from '../store.js';
import type { MemoryService } from './service.js';

export interface ReflectionDeps {
  getAgentInstance: (agent: Agent) => {
    reflect: (
      prompt: string,
      modelOverride?: { provider: string; modelId: string },
    ) => Promise<string>;
  } | null;
  sonnetModel: { provider: string; modelId: string };
}

export class ReflectionService {
  constructor(
    private store: WorldStore,
    private memory: MemoryService,
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

  private async reflectOne(agent: Agent, tick: number): Promise<void> {
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

    const reflection = await instance.reflect(prompt, this.deps.sonnetModel);

    await this.memory.record(agent.id, reflection, {
      tick,
      type: 'reflection',
      importance: 0.9,
    });
  }
}
