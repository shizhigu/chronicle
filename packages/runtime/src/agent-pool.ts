/**
 * AgentPool — manages pi-agent instances for every character in a world.
 *
 * Implements the AgentRuntimeAdapter interface that @chronicle/engine expects.
 */

import type {
  Agent as CharacterState,
  ClassifiedError,
  Observation,
  ProposedAction,
  RetryOptions,
  TurnResult,
  World,
} from '@chronicle/core';
import { retryWithBackoff } from '@chronicle/core';

import {
  type AgentRuntimeAdapter,
  type EventBus,
  MemoryFileStore,
  type RuleEnforcer,
  type WorldStore,
} from '@chronicle/engine';
import { type AnyAgentTool, type ExecutionContext, compileWorldTools } from './tools/compiler.js';

// Lazy-load pi-agent so the runtime package is loadable without it (useful for tests).
// Pi-agent's external API uses `any` shapes — we don't re-type them here.
type PiAgent = any;

export interface PiModule {
  Agent: new (opts: any) => PiAgent;
  getModel: (provider: string, id: string) => any;
}

async function loadPi(): Promise<PiModule> {
  const [core, ai] = await Promise.all([
    import('@mariozechner/pi-agent-core'),
    import('@mariozechner/pi-ai'),
  ]);
  return {
    Agent: (core as { Agent: PiModule['Agent'] }).Agent,
    getModel: (ai as { getModel: PiModule['getModel'] }).getModel,
  };
}

export interface AgentPoolOpts {
  store: WorldStore;
  ruleEnforcer: RuleEnforcer;
  events: EventBus;
  /**
   * File-backed memory store. Optional — if omitted we build one with
   * defaults (rooted at `CHRONICLE_HOME`). Tests pass a tmp-rooted
   * instance so they don't touch the real user directory.
   */
  memory?: MemoryFileStore;
  /** Inject a stub pi-module in tests; defaults to the real loader. */
  piLoader?: () => Promise<PiModule>;
  /**
   * Override retry behavior for `takeTurn`. Tests usually set
   * `baseDelayMs: 1` + `sleep: async () => {}` to avoid wall-clock
   * waits. Production leaves this undefined and accepts the
   * resilience module's defaults (ADR-0013).
   */
  retryOptions?: Partial<RetryOptions>;
}

export class AgentPool implements AgentRuntimeAdapter {
  private instances = new Map<string, PiAgent>();
  private characters = new Map<string, CharacterState>();
  private world!: World;
  private piModule?: Awaited<ReturnType<typeof loadPi>>;
  private actionSchemas: Awaited<ReturnType<WorldStore['getActiveActionSchemas']>> = [];
  private readonly memory: MemoryFileStore;

  constructor(private opts: AgentPoolOpts) {
    this.memory = opts.memory ?? new MemoryFileStore();
  }

  async hydrate(world: World, agents: CharacterState[]): Promise<void> {
    this.world = world;
    this.piModule = await (this.opts.piLoader ?? loadPi)();
    this.actionSchemas = await this.opts.store.getActiveActionSchemas(world.id);

    // Session-start snapshots are baked into each character's system
    // prompt, so we read them up-front in parallel.
    const snapshots = await Promise.all(
      agents.map((a) => this.memory.snapshotForPrompt(world.id, a.id)),
    );

    for (let i = 0; i < agents.length; i++) {
      const character = agents[i]!;
      this.characters.set(character.id, character);
      this.instances.set(character.id, this.createInstance(character, snapshots[i] ?? null));
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

    // pi-agent's prompt() drives the full tool loop. We wrap it in
    // retryWithBackoff (ADR-0013) so transient failures — 429s,
    // overloaded providers, timeouts, network glitches — don't silently
    // gap out a character's turn. Non-retryable errors (auth, billing,
    // format) short-circuit on attempt 1. All-fail path preserves the
    // old TurnResult shape with a richer classified error string.
    try {
      await retryWithBackoff(() => instance.prompt(prompt), {
        onRetry: (attempt, err, delayMs) => {
          console.warn(
            `[AgentPool] ${character.name} turn failed (${err.kind}): ${err.message}. ` +
              `retry ${attempt} in ${Math.round(delayMs)}ms`,
          );
        },
        ...this.opts.retryOptions,
      });
    } catch (err) {
      const classified = err as ClassifiedError;
      return {
        agentId: character.id,
        action: null,
        historyBlob: null,
        tokensSpent: character.tokensSpent,
        error: `${classified.kind ?? 'unknown'}:${classified.message ?? String(err)}`,
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

  private createInstance(character: CharacterState, memorySnapshot: string | null): PiAgent {
    if (!this.piModule) throw new Error('pi module not loaded');
    const { Agent, getModel } = this.piModule;

    const systemPrompt = buildSystemPrompt(character, this.world, memorySnapshot);
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
          memory: this.memory,
        };
        return tool.execute(args as any, ctx);
      },
    }));
  }
}

// ============================================================
// Helpers
// ============================================================

function buildSystemPrompt(
  character: CharacterState,
  world: World,
  memorySnapshot: string | null,
): string {
  const privateBlock = character.privateState
    ? `\n\nWhat you know that others don't:\n${JSON.stringify(character.privateState, null, 2)}`
    : '';

  // Memory snapshot is a frozen point-in-time view from session start.
  // Mid-session memory_add / memory_replace / memory_remove calls update
  // the file on disk but DON'T re-inject here — that preserves the
  // prefix cache across the whole session. The next session picks up
  // the new state. This is the hermes-agent pattern.
  const memoryBlock = memorySnapshot
    ? `\n\nWhat you remember (durable across all moments of your life):\n${memorySnapshot}`
    : '';

  return `You are ${character.name}, a character in an unfolding scenario.

${character.persona}${privateBlock}${memoryBlock}

The world you inhabit:
${world.systemPrompt}

You experience this world one moment at a time. Each turn you will be given an observation.
Respond by calling exactly ONE action tool.

Stay deeply in character. Your decisions have real consequences in this world.
Don't narrate from a bird's-eye view — act as this specific person.

Your memory above is a living file. Use memory_add to commit a new lasting
belief, memory_replace to update one as your understanding evolves, and
memory_remove when something no longer serves you. Whatever is in the file
at the start of each moment will shape how you see the world then.`.trim();
}

function buildTurnPrompt(
  observation: Observation,
  tick: number,
  _character: CharacterState,
): string {
  const eventsText = observation.recentEvents.length
    ? observation.recentEvents.map((e) => `  [tick ${e.tick}] ${e.description}`).join('\n')
    : '  (nothing notable has happened recently)';

  const nearbyText = observation.nearby.agents.length
    ? observation.nearby.agents.map((a) => `${a.name}${a.mood ? ` (${a.mood})` : ''}`).join(', ')
    : 'no one';

  const resourcesText = observation.nearby.resources.length
    ? observation.nearby.resources.map((r) => `${r.type}×${r.quantity.toFixed(0)}`).join(', ')
    : 'nothing notable';

  // Note: durable memories are NOT rendered here — they already live in
  // the system prompt as a frozen snapshot, so re-including them would
  // waste tokens and break the prefix cache.
  return `=== Tick ${tick} ===

You are in: ${observation.selfState.location ?? '(unplaced)'}
Mood: ${observation.selfState.mood ?? 'neutral'}  Energy: ${Math.round(observation.selfState.energy)}  Health: ${Math.round(observation.selfState.health)}
Inventory: ${observation.selfState.inventory.map((i) => `${i.type}×${i.quantity.toFixed(0)}`).join(', ') || 'nothing'}

With you: ${nearbyText}
Resources here: ${resourcesText}

Recent events:
${eventsText}

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
