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
  ProviderSpec,
  RetryOptions,
  TurnResult,
  World,
} from '@chronicle/core';
import {
  findProviderSpec,
  resolveProviderApiKey,
  resolveProviderBaseUrl,
  retryWithBackoff,
} from '@chronicle/core';

import {
  type AgentRuntimeAdapter,
  type EventBus,
  MemoryFileStore,
  type RuleEnforcer,
  type WorldStore,
} from '@chronicle/engine';
import { zodToJsonSchema } from 'zod-to-json-schema';
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
    // Snapshot transcript length BEFORE prompt() so we can extract
    // only the messages produced during this turn (pi-agent may
    // append several assistant + toolResult messages per prompt()).
    const messagesBefore = (instance.state?.messages ?? []).length;

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

    // Strip hallucinated tool-call round-trips before the transcript
    // is re-used for the next turn. Some local models (Gemma-4 in
    // particular) emit a templated chat completion that contains
    // *their own* synthetic toolCall + toolResult pairs with names
    // like "Observe the King" or "Seek Counsel in Private". Pi-agent's
    // transport deserialises these into real transcript messages,
    // and on the NEXT prompt() the model sees its own fabrication
    // and compounds it. Remove any toolCall block whose name isn't
    // in our allow-list, plus the corresponding toolResult message.
    const validNames = new Set<string>(
      ((instance.state?.tools ?? []) as Array<{ name: string }>).map((t) => t.name),
    );
    stripHallucinatedToolCalls(
      instance.state?.messages as any[] | undefined,
      messagesBefore,
      validNames,
    );

    // Extract the "primary" tool call from this turn's messages.
    // pi-agent's prompt() may iterate multiple rounds; the LAST
    // assistant message is often an empty-arg retry after a
    // context-window bump or a cleanup echo. Walk every assistant
    // message produced this turn and pick the last toolCall whose
    // `arguments` carry content — that's the decision we want to
    // record as the agent's action for drama + event log.
    const messages = (instance.state?.messages ?? []) as any[];
    const turnMessages = messages.slice(messagesBefore);
    const action = extractPrimaryToolCall(turnMessages, character.id);

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
      const prevGetApiKey = instance.getApiKey;
      const resolved = resolveModelForPi(
        modelOverride.provider,
        modelOverride.modelId,
        this.piModule.getModel,
      );
      instance.state.model = resolved.model;
      // Swap `getApiKey` too — otherwise a reflection run against a
      // local-server model (LM Studio, Ollama) uses the agent's
      // original apiKey, which for cloud-agent / local-reflection
      // pairings drops back to pi-ai's default 'No API key' error.
      // Same failure shape I fixed for the prompt path in 3ae2b66.
      instance.getApiKey = () => resolved.apiKey;
      try {
        await instance.prompt(prompt);
      } finally {
        instance.state.model = prevModel;
        instance.getApiKey = prevGetApiKey;
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
    // Allow-list for tool-name validation in beforeToolCall. pi-agent's
    // default behavior when the LLM invents a tool name that isn't in
    // `tools` is to synthesize a fake-success toolResult — the model
    // then thinks it "performed `Observe the King_performed`" and its
    // sense of world state silently diverges from reality. Rejecting
    // unknown names in beforeToolCall surfaces the hallucination as
    // an error the model can recover from in the next round.
    const toolNames = new Set(tools.map((t) => t.name));
    const messages = character.sessionStateBlob
      ? safeDeserializeMessages(Buffer.from(character.sessionStateBlob))
      : [];

    // Resolve the pi-ai Model: hand-build for OpenAI-compatible local
    // servers (LM Studio, Ollama, vLLM, llama.cpp) + Chinese/aggregator
    // clouds whose transport is `openai-chat`; fall back to pi-ai's
    // native `getModel(...)` for Anthropic/Google/OpenAI. Without this,
    // local-server worlds silently hit pi-ai's `api: 'unknown'` branch
    // and every agent turn returns an empty message with
    // `stopReason: 'error'` — which then looks like "the model just
    // chose to do nothing." See compiler/src/llm.ts for the same logic.
    const resolved = resolveModelForPi(character.provider, character.modelId, getModel);

    const instance = new Agent({
      initialState: {
        systemPrompt,
        model: resolved.model,
        thinkingLevel: character.thinkingLevel,
        tools,
        messages,
      },
      // pi-agent routes the api key through a callback rather than a
      // static field so a single Agent instance can target providers
      // whose credentials change between turns.
      getApiKey: () => resolved.apiKey,
      sessionId: `chr_${this.world.id}_${character.id}`,

      beforeToolCall: async ({ toolCall, args }: { toolCall: any; args: unknown }) => {
        // First gate: unknown tool names. pi-agent otherwise synthesizes
        // `<name>_performed` as a fake success, and the LLM's world
        // model drifts from reality.
        if (!toolNames.has(toolCall.name)) {
          return {
            block: true,
            reason: `unknown_tool:${toolCall.name} — call one of: ${[...toolNames].slice(0, 8).join(', ')}${toolNames.size > 8 ? ', …' : ''}`,
          };
        }
        // Second gate: rule enforcement on the proposed action.
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

      afterToolCall: async ({
        toolCall,
        args,
        isError,
      }: {
        toolCall: any;
        args: unknown;
        isError: boolean;
      }) => {
        // Some local models fabricate toolCall names that aren't in
        // the registered tools list (Gemma-4 is a repeat offender:
        // "Observe the King", "Seek Counsel in Private"). Pi-agent
        // still fires afterToolCall for these — the fake toolResult
        // is already in the stream — so we'd otherwise surface them
        // on the bus as successful actions. Mark them as errors so
        // the UI + CLI render them as ✗, and short-circuit the
        // speech path so a hallucinated "speak" with a made-up name
        // can't leak content into the event log.
        const effectiveIsError = isError || !toolNames.has(toolCall.name);
        this.opts.events.emit({
          type: 'action_completed',
          worldId: this.world.id,
          agentId: character.id,
          tool: toolCall.name,
          isError: effectiveIsError,
        });
        // Also surface `speak` as a rich `speech` bus event so the
        // CLI --live output and any other single-process subscriber
        // see the content/to/tone.
        if (toolCall.name === 'speak' && !effectiveIsError) {
          const a = (args ?? {}) as { to?: string; content?: string; tone?: string | null };
          if (typeof a.content === 'string' && a.content.length > 0) {
            this.opts.events.emit({
              type: 'speech',
              worldId: this.world.id,
              tick: this.world.currentTick + 1, // in-progress tick
              fromAgentId: character.id,
              toTarget: a.to ?? 'all',
              content: a.content,
              tone: a.tone ?? null,
            });
          }
        }
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
   *
   * Pi-agent expects `parameters: TSchema` (TypeBox JSON-schema) on the
   * `Tool` interface, not `parametersSchema: ZodSchema`. TypeBox schemas
   * are plain JSON Schema at runtime, so converting the Zod schema once
   * and handing over the resulting JSON Schema is equivalent. Without
   * this, pi-agent's schema validator blows up with
   * `"schema must be object or boolean"` on the first tool invocation
   * and the assistant message dies with `stopReason: 'error'`.
   *
   * The label + prepareArguments fields pi-agent's AgentTool wants are
   * optional — omitting them is fine.
   */
  private wrapToolsForPi(tools: AnyAgentTool[], character: CharacterState) {
    return tools.map((tool) => {
      // zod-to-json-schema chats noisy `"Recursive reference detected at
      // …! Defaulting to any"` warnings on stderr for every truly
      // recursive schema (propose's `DeadlineSchema` has a self-ref
      // via `any_of.options`). With `$refStrategy: 'none'` the "any"
      // fallback is the intended behavior — not a bug — so we suppress
      // just the recursive-reference line during conversion rather
      // than have it print on every tick of every run.
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        const first = args[0];
        if (typeof first === 'string' && first.startsWith('Recursive reference detected')) return;
        origWarn(...args);
      };
      let parameters: Record<string, unknown>;
      try {
        parameters = zodToJsonSchema(tool.parametersSchema, {
          // Inline everything — pi-agent's validator doesn't follow
          // $refs, so a nested ref would reproduce the same
          // "schema must be object or boolean" failure one level deeper.
          $refStrategy: 'none',
          target: 'openApi3',
        }) as Record<string, unknown>;
      } finally {
        console.warn = origWarn;
      }
      return {
        name: tool.name,
        description: tool.description,
        parameters,
        // We also keep the original Zod schema under parametersSchema
        // so anything in our codebase that still reads it (tests, etc.)
        // keeps working.
        parametersSchema: tool.parametersSchema,
        // Pi-agent-core calls tools as
        // `execute(toolCallId, params, signal?, onUpdate?)` — params is
        // the VALIDATED argument object, at position 2. An earlier
        // version of this wrapper accepted `(args)` as a single positional
        // arg, so it was receiving the toolCallId *string* instead of
        // params. Every tool that destructured its args — `speak({to,
        // content})`, `memory_add({content})`, etc. — then threw
        // `undefined is not an object` from inside the destructure.
        // Match pi-agent's signature exactly and forward `params`.
        execute: async (_toolCallId: string, params: unknown) => {
          const fresh = await this.opts.store.getAgent(character.id);
          this.characters.set(character.id, fresh);
          const ctx: ExecutionContext = {
            world: this.world,
            character: fresh,
            tick: this.world.currentTick + 1, // in-progress tick
            store: this.opts.store,
            memory: this.memory,
          };
          const raw = await tool.execute(params as any, ctx);
          // Chronicle tools return `{ ok, detail?, sideEffects? }`;
          // pi-agent-core expects `AgentToolResult<T> = { content: Block[], details: T }`.
          // Wrap once here so individual tool implementations don't care.
          return {
            content: [{ type: 'text' as const, text: raw.detail ?? (raw.ok ? 'ok' : 'failed') }],
            details: raw,
          };
        },
      };
    });
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

/**
 * Walk a turn's assistant messages in order and return the most
 * meaningful tool call — the last one whose `arguments` object is
 * non-empty. That corresponds to the agent's real decision for the
 * turn, not an empty-arg retry the LLM emitted after hitting a
 * context bump or an error result.
 *
 * Fallback: if no tool call has args (e.g. every call was `observe`
 * which legitimately takes no args), return the LAST tool call we
 * saw so we still record *something*. Returns null only if no tool
 * call appeared anywhere in the turn — that path feeds into the
 * engine's `agent_silent` tracer.
 */
/**
 * Remove hallucinated tool-call round-trips from the pi-agent transcript
 * in place. Scoped to messages added during the current turn (from
 * `turnStart` onward) so we don't rewrite locked-in history from
 * prior turns.
 *
 * An assistant message may carry [text, toolCall, text, toolCall]
 * blocks. Drop any toolCall block whose name isn't in `valid`. If the
 * drop leaves the assistant content empty, drop the whole assistant
 * message. Also drop any toolResult message whose toolCallId refers
 * to a removed toolCall.
 */
function stripHallucinatedToolCalls(
  messages: any[] | undefined,
  turnStart: number,
  valid: Set<string>,
): void {
  if (!messages) return;
  const droppedIds = new Set<string>();

  // First pass: rewrite assistant messages in the turn window.
  for (let i = turnStart; i < messages.length; i++) {
    const m = messages[i];
    if (m?.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const kept: any[] = [];
    for (const block of m.content) {
      if (block?.type === 'toolCall' && typeof block.name === 'string' && !valid.has(block.name)) {
        if (typeof block.id === 'string') droppedIds.add(block.id);
        continue;
      }
      kept.push(block);
    }
    m.content = kept;
  }

  // Second pass: drop toolResult messages that referenced a removed
  // toolCall, plus assistant messages that are now empty (no text +
  // no surviving toolCall).
  for (let i = messages.length - 1; i >= turnStart; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === 'toolResult' && droppedIds.has(m.toolCallId)) {
      messages.splice(i, 1);
      continue;
    }
    if (m.role === 'assistant' && Array.isArray(m.content) && m.content.length === 0) {
      messages.splice(i, 1);
    }
  }
}

function extractPrimaryToolCall(turnMessages: any[], actorId: string): ProposedAction | null {
  let lastAny: ProposedAction | null = null;
  let lastWithArgs: ProposedAction | null = null;
  for (const m of turnMessages) {
    if (m?.role !== 'assistant') continue;
    const content = m.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const proposed = toolCallFromBlock(block, actorId);
      if (!proposed) continue;
      lastAny = proposed;
      if (Object.keys(proposed.args).length > 0) lastWithArgs = proposed;
    }
  }
  return lastWithArgs ?? lastAny;
}

function toolCallFromBlock(block: any, actorId: string): ProposedAction | null {
  // pi-agent-core emits `{ type: 'toolCall', name, arguments }` (see
  // AgentToolCall in its types.d.ts). Older parts of our codebase
  // still reference the Anthropic-style `{ type: 'tool_use', name,
  // input }` so we accept both — dropping the old path would break
  // existing test fixtures until they're migrated.
  if (block?.type === 'toolCall' && typeof block.name === 'string') {
    return {
      agentId: actorId,
      actionName: block.name,
      args: (block.arguments as Record<string, unknown>) ?? {},
      proposedAt: Date.now(),
    };
  }
  if (block?.type === 'tool_use' && typeof block.name === 'string') {
    return {
      agentId: actorId,
      actionName: block.name,
      args: (block.input as Record<string, unknown>) ?? {},
      proposedAt: Date.now(),
    };
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

/**
 * Resolve a pi-ai Model for `(provider, modelId)`. Mirrors the logic in
 * `@chronicle/compiler`'s `createLlm`: hand-build an OpenAI-compat Model
 * when the provider spec says so (local servers + Chinese clouds +
 * aggregators); otherwise defer to pi-ai's native `getModel`.
 *
 * Returns both the Model config and the api key that should be handed
 * to pi-agent. Local servers accept any string so we default to
 * 'lm-studio'; cloud providers pull from their env var priority list.
 */
function resolveModelForPi(
  provider: string,
  modelId: string,
  piGetModel: (provider: string, id: string) => any,
): { model: any; apiKey: string | undefined } {
  const spec = findProviderSpec(provider);
  if (!spec || spec.transport !== 'openai-chat') {
    // Anthropic / OpenAI / Google — pi-ai has native transports for
    // these. Their api keys are sourced from env by pi-ai itself.
    return { model: piGetModel(provider, modelId), apiKey: undefined };
  }
  const baseUrl = resolveProviderBaseUrl(spec, process.env);
  if (!baseUrl) {
    // Spec exists but no base URL resolvable — fall through to pi-ai
    // so the failure surfaces there with a clear provider error.
    return { model: piGetModel(provider, modelId), apiKey: undefined };
  }
  return {
    model: buildOpenAiCompatModel(spec, modelId, baseUrl),
    apiKey: resolveApiKeyForHandBuilt(spec),
  };
}

function buildOpenAiCompatModel(spec: ProviderSpec, modelId: string, baseUrl: string) {
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: 'openai',
    baseUrl,
    reasoning: false,
    input: ['text'] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_768,
    maxTokens: 8_192,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: 'max_tokens' as const,
    },
  };
}

function resolveApiKeyForHandBuilt(spec: ProviderSpec): string | undefined {
  if (spec.authType === 'local-server') {
    const explicit = resolveProviderApiKey(spec, process.env);
    return explicit?.value ?? process.env.LMSTUDIO_API_KEY ?? 'lm-studio';
  }
  const resolved = resolveProviderApiKey(spec, process.env);
  return resolved?.value;
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
