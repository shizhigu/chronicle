/**
 * AgentPool — manages pi-agent instances for every character in a world.
 *
 * Implements the AgentRuntimeAdapter interface that @chronicle/engine expects.
 */

import type {
  Agent as CharacterState,
  Observation,
  ProposedAction,
  TurnResult,
  World,
} from '@chronicle/core';

import type { AgentRuntimeAdapter, EventBus, RuleEnforcer, WorldStore } from '@chronicle/engine';
import { type AnyAgentTool, type ExecutionContext, compileWorldTools } from './tools/compiler.js';

// Lazy-load pi-agent so the runtime package is loadable without it (useful for tests).
type PiAgent = any;
async function loadPi(): Promise<{
  Agent: new (opts: any) => PiAgent;
  getModel: (provider: string, id: string) => any;
}> {
  const [core, ai] = await Promise.all([
    import('@mariozechner/pi-agent-core'),
    import('@mariozechner/pi-ai'),
  ]);
  return { Agent: (core as any).Agent, getModel: (ai as any).getModel };
}

export interface AgentPoolOpts {
  store: WorldStore;
  ruleEnforcer: RuleEnforcer;
  events: EventBus;
}

export class AgentPool implements AgentRuntimeAdapter {
  private instances = new Map<string, PiAgent>();
  private characters = new Map<string, CharacterState>();
  private world!: World;
  private piModule?: Awaited<ReturnType<typeof loadPi>>;
  private actionSchemas: Awaited<ReturnType<WorldStore['getActiveActionSchemas']>> = [];

  constructor(private opts: AgentPoolOpts) {}

  async hydrate(world: World, agents: CharacterState[]): Promise<void> {
    this.world = world;
    this.piModule = await loadPi();
    this.actionSchemas = await this.opts.store.getActiveActionSchemas(world.id);

    for (const character of agents) {
      this.characters.set(character.id, character);
      this.instances.set(character.id, this.createInstance(character));
    }
  }

  async takeTurn(
    character: CharacterState,
    observation: Observation,
    tick: number,
  ): Promise<TurnResult> {
    const instance = this.instances.get(character.id);
    if (!instance) {
      throw new Error(`No agent instance for ${character.id}`);
    }

    // Budget check
    if (character.tokensBudget !== null && character.tokensSpent >= character.tokensBudget) {
      return {
        agentId: character.id,
        action: null,
        historyBlob: null,
        tokensSpent: character.tokensSpent,
        error: 'budget_exhausted',
      };
    }

    const prompt = buildTurnPrompt(observation, tick, character);
    const tokensBefore = character.tokensSpent;

    // pi-agent's prompt() drives the full tool loop
    try {
      await instance.prompt(prompt);
    } catch (err) {
      return {
        agentId: character.id,
        action: null,
        historyBlob: null,
        tokensSpent: character.tokensSpent,
        error: String(err),
      };
    }

    // Extract first tool call from the latest assistant message (our chosen action)
    const messages = (instance.state?.messages ?? []) as any[];
    const latestAssistant = findLast(messages, (m) => m?.role === 'assistant');
    const action = latestAssistant ? extractToolCall(latestAssistant, character.id) : null;

    const historyBlob = Buffer.from(JSON.stringify(messages), 'utf-8');
    const tokensSpent = estimateTokensFromMessages(messages, tokensBefore);

    return {
      agentId: character.id,
      action,
      historyBlob,
      tokensSpent,
    };
  }

  async applyAction(
    character: CharacterState,
    _action: ProposedAction,
    _tick: number,
  ): Promise<void> {
    // pi-agent already invoked the tool's execute() inside prompt(). Here we just
    // mirror state back into in-memory character reference (sessionStateBlob,
    // energy, location) so the next tick sees consistent state.
    // The canonical source is the DB, which the tool already updated.
    const fresh = await this.opts.store.getAgent(character.id);
    this.characters.set(character.id, fresh);
  }

  async reflect(
    character: CharacterState,
    prompt: string,
    modelOverride?: { provider: string; modelId: string },
  ): Promise<string> {
    const instance = this.instances.get(character.id);
    if (!instance) throw new Error(`No agent instance for ${character.id}`);

    if (modelOverride && this.piModule) {
      const prevModel = instance.state.model;
      instance.state.model = this.piModule.getModel(modelOverride.provider, modelOverride.modelId);
      try {
        await instance.prompt(prompt);
      } finally {
        instance.state.model = prevModel;
      }
    } else {
      await instance.prompt(prompt);
    }

    const messages = (instance.state?.messages ?? []) as any[];
    const latestAssistant = findLast(messages, (m) => m?.role === 'assistant');
    if (!latestAssistant) return '';
    return extractText(latestAssistant);
  }

  async shutdown(): Promise<void> {
    for (const instance of this.instances.values()) {
      try {
        instance?.abort?.();
      } catch {
        /* ignore */
      }
    }
    this.instances.clear();
    this.characters.clear();
  }

  private createInstance(character: CharacterState): PiAgent {
    if (!this.piModule) throw new Error('pi module not loaded');
    const { Agent, getModel } = this.piModule;

    const systemPrompt = buildSystemPrompt(character, this.world);
    const tools = this.wrapToolsForPi(
      compileWorldTools(this.world, character, this.opts.store, this.actionSchemas),
      character,
    );
    const messages = character.sessionStateBlob
      ? safeDeserializeMessages(Buffer.from(character.sessionStateBlob))
      : [];

    const instance = new Agent({
      initialState: {
        systemPrompt,
        model: getModel(character.provider, character.modelId),
        thinkingLevel: character.thinkingLevel,
        tools,
        messages,
      },
      sessionId: `chr_${this.world.id}_${character.id}`,

      beforeToolCall: async ({ toolCall, args }: { toolCall: any; args: unknown }) => {
        const validation = await this.opts.ruleEnforcer.validate({
          character,
          action: {
            agentId: character.id,
            actionName: toolCall.name,
            args: (args as Record<string, unknown>) ?? {},
            proposedAt: Date.now(),
          },
        });
        if (!validation.ok) {
          return { block: true, reason: validation.reason ?? 'rule_violation' };
        }
        return undefined;
      },

      afterToolCall: async ({ toolCall, isError }: { toolCall: any; isError: boolean }) => {
        this.opts.events.emit({
          type: 'action_completed',
          worldId: this.world.id,
          agentId: character.id,
          tool: toolCall.name,
          isError,
        });
      },
    });

    // Stream live thinking deltas to event bus
    instance.subscribe?.((event: any) => {
      if (event.type === 'message_update') {
        this.opts.events.emit({
          type: 'char_thinking',
          worldId: this.world.id,
          agentId: character.id,
          delta: event.assistantMessageEvent,
        });
      }
    });

    return instance;
  }

  /**
   * Wrap our internal tools so their execute() receives our ExecutionContext.
   */
  private wrapToolsForPi(tools: AnyAgentTool[], character: CharacterState) {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      // pi-agent uses the schema to validate + serialize to LLM tool format
      parametersSchema: tool.parametersSchema,
      execute: async (args: unknown) => {
        const fresh = await this.opts.store.getAgent(character.id);
        this.characters.set(character.id, fresh);
        const ctx: ExecutionContext = {
          world: this.world,
          character: fresh,
          tick: this.world.currentTick + 1, // in-progress tick
          store: this.opts.store,
        };
        return tool.execute(args as any, ctx);
      },
    }));
  }
}

// ============================================================
// Helpers
// ============================================================

function buildSystemPrompt(character: CharacterState, world: World): string {
  const privateBlock = character.privateState
    ? `\n\nWhat you know that others don't:\n${JSON.stringify(character.privateState, null, 2)}`
    : '';

  return `You are ${character.name}, a character in an unfolding scenario.

${character.persona}${privateBlock}

The world you inhabit:
${world.systemPrompt}

You experience this world one moment at a time. Each turn you will be given an observation.
Respond by calling exactly ONE action tool.

Stay deeply in character. Your decisions have real consequences in this world.
Don't narrate from a bird's-eye view — act as this specific person.`.trim();
}

function buildTurnPrompt(
  observation: Observation,
  tick: number,
  _character: CharacterState,
): string {
  const eventsText = observation.recentEvents.length
    ? observation.recentEvents.map((e) => `  [tick ${e.tick}] ${e.description}`).join('\n')
    : '  (nothing notable has happened recently)';

  const memoriesText = observation.relevantMemories.length
    ? observation.relevantMemories.map((m) => `  - ${m.content}`).join('\n')
    : '  (no strong memories surface)';

  const nearbyText = observation.nearby.agents.length
    ? observation.nearby.agents.map((a) => `${a.name}${a.mood ? ` (${a.mood})` : ''}`).join(', ')
    : 'no one';

  const resourcesText = observation.nearby.resources.length
    ? observation.nearby.resources.map((r) => `${r.type}×${r.quantity.toFixed(0)}`).join(', ')
    : 'nothing notable';

  return `=== Tick ${tick} ===

You are in: ${observation.selfState.location ?? '(unplaced)'}
Mood: ${observation.selfState.mood ?? 'neutral'}  Energy: ${Math.round(observation.selfState.energy)}  Health: ${Math.round(observation.selfState.health)}
Inventory: ${observation.selfState.inventory.map((i) => `${i.type}×${i.quantity.toFixed(0)}`).join(', ') || 'nothing'}

With you: ${nearbyText}
Resources here: ${resourcesText}

Recent events:
${eventsText}

What you remember:
${memoriesText}

Take exactly ONE action. Call a tool.`.trim();
}

function extractToolCall(assistantMessage: any, actorId: string): ProposedAction | null {
  const content = assistantMessage?.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block?.type === 'tool_use' && typeof block.name === 'string') {
      return {
        agentId: actorId,
        actionName: block.name,
        args: (block.input as Record<string, unknown>) ?? {},
        proposedAt: Date.now(),
      };
    }
  }
  return null;
}

function extractText(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
}

function safeDeserializeMessages(blob: Buffer): any[] {
  try {
    const parsed = JSON.parse(blob.toString('utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function estimateTokensFromMessages(messages: any[], before: number): number {
  // Extremely rough estimate until we plumb actual usage from pi-agent responses
  const totalChars = messages.reduce((n, m) => n + JSON.stringify(m ?? '').length, 0);
  const estimated = Math.floor(totalChars / 4);
  return Math.max(before, estimated);
}

function findLast<T>(arr: T[], pred: (item: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i]!)) return arr[i]!;
  }
  return undefined;
}
