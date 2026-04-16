# Agent Runtime — Technical Decision (pi-agent)

## The Decision

**Runtime**: [`@mariozechner/pi-agent-core`](https://github.com/badlogic/pi-mono/tree/main/packages/agent) + [`@mariozechner/pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai)
**Language**: TypeScript / Node.js (entire stack)
**Not chosen**: Claude Agent SDK (locks to Anthropic), Pydantic AI (Python, forces language split), Claude Code subagents (too heavy per character).

---

## Why pi-agent

**Every characteristic we need is already there:**

| Need | pi-agent feature |
|---|---|
| Model-agnostic | `pi-ai` unified API — Anthropic/OpenAI/Google/Bedrock/local via vLLM |
| Stateful per-character | `Agent` class holds `state.messages` = persistent context |
| Same context = same agent | `sessionId` + stateful instance; serialize messages to DB |
| Tool calling | `tools: AgentTool[]` with before/after hooks |
| Rule enforcement hook | `beforeToolCall(({toolCall, args}) => {block: bool})` — perfect fit |
| Event-driven | `agent.subscribe(event => ...)` — maps directly to our tick pipeline |
| Thinking budgets | `thinkingLevel: off | minimal | low | medium | high | xhigh` per agent |
| Parallel tool exec | `toolExecution: "parallel"` built-in |
| Streaming | `message_update` deltas stream to dashboard via WebSocket |
| Provider caching | `sessionId` enables Anthropic prompt caching automatically |
| Custom messages | AgentMessage supports app-specific types (we add `observation`, `memory`, `reflection`) |

**And it's lightweight.** No subprocesses, no heavy framework, just TypeScript classes. Runs 50+ agents in one Node process.

---

## Why TypeScript across the whole stack

One language from data layer through frontend:

```
┌─────────────────────────────────────┐
│ Frontend (Next.js 15 + Canvas)      │ TypeScript
├─────────────────────────────────────┤
│ CLI (node + commander)              │ TypeScript
├─────────────────────────────────────┤
│ Engine (tick loop, rule enforcer)   │ TypeScript
├─────────────────────────────────────┤
│ Agent Runtime (pi-agent)            │ TypeScript
├─────────────────────────────────────┤
│ DB layer (better-sqlite3 + Drizzle) │ TypeScript
└─────────────────────────────────────┘
```

One `package.json`, one type system, shared interfaces between frontend/backend (world state types, event payloads), no FFI. Means faster iteration and fewer integration bugs.

---

## Core Pattern — Character as an Agent

```typescript
import { Agent, AgentTool } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { WorldContext, CharacterState } from "./types";

export function createCharacterAgent(
  character: CharacterState,
  world: WorldContext,
): Agent {
  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(character, world),
      model: getModel(character.provider, character.modelId),
      thinkingLevel: character.thinkingLevel ?? "low",
      tools: compileWorldTools(world, character),
      messages: deserializeHistory(character.sessionStateBlob),
    },

    // Session ID for provider caching (Anthropic caches system prompt between calls)
    sessionId: `chr_${world.id}_${character.id}`,

    // RULE ENFORCEMENT injects here — before every tool call, validate against rules
    beforeToolCall: async ({ toolCall, args }) => {
      const validation = ruleEnforcer.validate({
        character,
        world,
        action: { name: toolCall.name, args },
      });
      if (!validation.ok) {
        return { block: true, reason: validation.reason };
      }
    },

    // After tool runs, log as event + notify observers
    afterToolCall: async ({ toolCall, result, isError }) => {
      await eventLog.append({
        worldId: world.id,
        tick: world.tick,
        actorId: character.id,
        eventType: "action",
        data: { tool: toolCall.name, result, isError },
      });
      broadcastDelta(world.id, { type: "action", character: character.id });
    },
  });

  // Stream UI updates for live dashboard
  agent.subscribe((event) => {
    if (event.type === "message_update") {
      broadcastDelta(world.id, {
        type: "char_thinking",
        character: character.id,
        delta: event.assistantMessageEvent,
      });
    }
  });

  return agent;
}
```

**The `beforeToolCall` hook is the whole game.** Every character action routes through it, rule compiler's output plugs in naturally.

---

## The Tick Loop

```typescript
async function runTick(world: World) {
  // 1. Compute per-character observations (what each sees)
  const observations = world.liveCharacters.map(c => ({
    character: c,
    observation: computeObservation(c, world),
  }));

  // 2. Parallel agent prompts (all characters decide simultaneously from same snapshot)
  const results = await Promise.all(
    observations.map(async ({ character, observation }) => {
      const agent = characterAgents.get(character.id)!;

      // Inject memories + observation
      const memories = await retrieveMemories(character, observation, 10);
      const prompt = buildTurnPrompt(observation, memories, character.currentGoals);

      // Budget check before incurring cost
      if (character.tokensBudget !== null &&
          character.tokensSpent >= character.tokensBudget) {
        return { character, action: "exhausted" };
      }

      await agent.prompt(prompt);
      return {
        character,
        action: extractToolCall(agent.state.messages),
        historyBlob: serializeHistory(agent.state.messages),
      };
    })
  );

  // 3. Serial deterministic resolution
  const sortedActions = sortForResolution(results, world.rngSeed, world.tick);
  for (const result of sortedActions) {
    await applyResolvedAction(world, result);
  }

  // 4. Persist agent histories + world state
  await db.transaction(tx => {
    for (const result of results) {
      tx.update(agents).set({
        sessionStateBlob: result.historyBlob,
        // ... any updated fields
      }).where(eq(agents.id, result.character.id));
    }
  });

  // 5. Trigger reflections if due
  if (world.tick % 20 === 0) {
    await triggerReflections(world);
  }

  // 6. Apply queued god interventions
  await applyGodInterventions(world);

  world.tick += 1;
  broadcastTickEnd(world);
}
```

---

## Model Tiering Config

Every character has its own model config — heterogeneous worlds are natural:

```typescript
// In world config (compiled from natural language)
{
  id: "marcus",
  persona: "...",
  provider: "anthropic",
  modelId: "claude-haiku-4-5",        // routine actions
  reflectionModel: {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",     // deeper reflections every 20 ticks
  },
  thinkingLevel: "low",
}

// A "wise elder" character might look like:
{
  id: "ancient_sage",
  persona: "...",
  provider: "anthropic",
  modelId: "claude-sonnet-4-6",
  thinkingLevel: "medium",             // uses extended thinking
}

// Or free/local:
{
  id: "villager_01",
  persona: "...",
  provider: "openai-compatible",
  modelId: "qwen-2.5-72b",
  baseUrl: "http://localhost:11434/v1", // local Ollama
  thinkingLevel: "off",
}
```

`pi-ai` handles the provider translation. Our engine just sees `Agent`.

---

## Tool Compilation

World config has `action_schemas`. We compile each into a `pi-agent` tool:

```typescript
function compileWorldTools(
  world: WorldContext,
  character: CharacterState,
): AgentTool[] {
  return world.actionSchemas
    .filter(s => isAvailableTo(s, character))
    .map(schema => ({
      name: schema.name,
      description: schema.description,
      parametersSchema: zodFromJsonSchema(schema.parametersSchema),
      execute: async (args, context) => {
        // Actual world mutation happens here
        return await executeAction(world, character, schema, args);
      },
    }));
}
```

Core tools every character has (`observe`, `speak`, `think`) plus world-specific ones (`move`, `craft`, `attack`, etc., depending on the scenario).

### Example: `speak` tool

```typescript
const speakTool: AgentTool = {
  name: "speak",
  description:
    "Say something to another character or the room. Provide 'to' as name, 'all', or 'whisper:<name>'.",
  parametersSchema: z.object({
    to: z.string(),
    content: z.string(),
    tone: z.enum(["neutral", "angry", "whispered", "shouted", "sarcastic"]).default("neutral"),
  }),
  execute: async ({ to, content, tone }, ctx) => {
    const message = {
      worldId: ctx.world.id,
      tick: ctx.world.tick,
      fromAgentId: ctx.character.id,
      toAgentOrChannel: to,
      content,
      tone,
    };
    await db.insert(messages).values(message);

    // Determine audience based on proximity / channel semantics
    const heardBy = computeAudience(ctx.world, message);
    await injectHearingMemory(heardBy, message);

    broadcastDelta(ctx.world.id, { type: "speech", message });
    return { ok: true, heardBy: heardBy.map(a => a.id) };
  },
};
```

---

## Persistent Identity Across Ticks

Each character's identity persists because:

1. **Same `Agent` instance** kept in-process while world is running. No reconstruction per tick.
2. **`agent.state.messages` accumulates** across every `prompt()` call.
3. **On shutdown/resume**: we serialize `state.messages` to DB as `session_state_blob`. On next start, `new Agent({ initialState: { messages: deserialized } })` continues exactly where it left off.
4. **`sessionId` string** stays stable (`chr_{world}_{character}`), so Anthropic/Bedrock prompt caching hits every time.

Same context ≡ same character. That's the user's axiom, and pi-agent's default behavior satisfies it.

---

## Memory Architecture

### Layer 1: Session history (in-memory, in `Agent.state.messages`)

Handled by pi-agent automatically. Everything the character has seen/said/thought during this run.

### Layer 2: Episodic memory (DB)

Events filtered for importance become memory records:

```typescript
interface AgentMemory {
  id: number;
  agentId: string;
  createdTick: number;
  memoryType: "observation" | "reflection" | "goal" | "belief_about_other";
  content: string;
  importance: number;    // 0–1
  relatedEventId?: number;
  aboutAgentId?: string;
  embedding?: Buffer;    // optional semantic index
}
```

Retrieved per tick by `retrieveMemories(character, observation, k=10)` — recency × importance × similarity.

### Layer 3: Reflections (LLM-synthesized)

Every 20 ticks we invoke:

```typescript
await agent.prompt(`
REFLECTION TIME. Summarize the last 20 ticks:
1. Key events from your POV
2. How your relationships shifted
3. Current priorities
4. Anything you've learned
`);
```

The LLM's reply is stored as a high-importance memory. This keeps long-term continuity without bloating context.

### Context compaction

pi-agent's `transformContext` hook runs before `convertToLlm`:

```typescript
transformContext: async (messages) => {
  if (totalTokens(messages) > 150_000) {
    // Summarize oldest half
    const [old, recent] = splitAt(messages, Math.floor(messages.length / 2));
    const summary = await summarize(old);
    return [{ role: "system", content: `[Past summary]: ${summary}` }, ...recent];
  }
  return messages;
},
```

Keeps context windows bounded.

---

## Cost Estimates

With aggressive tiering (Haiku for 95% of turns, Sonnet for 5% reflections):

| Scenario | Cost |
|---|---|
| 5 characters, 100 ticks, Haiku | $0.40 |
| 10 characters, 500 ticks, mixed | $6 |
| 20 characters, 1000 ticks, mixed | $25 |
| 50 characters, 5000 ticks, full civilization | $300 |
| Same as above on local Ollama (llama 3.3 70b) | $0 |

Prompt caching (enabled automatically via `sessionId`) saves ~70% of system-prompt tokens. Observation caching saves another ~30% when nothing near an agent changes.

---

## Example: Boot Sequence

```typescript
import { Engine } from "@chronicle/engine";

const engine = new Engine({ dbPath: "./world.db" });

// Load world from DB
const world = await engine.loadWorld("chr_7f3p2q");

// Create pi-agent instances for every live character (deserialized history)
for (const character of world.liveCharacters) {
  const agent = createCharacterAgent(character, world);
  engine.registerAgent(character.id, agent);
}

// Start tick loop
await engine.run({
  ticks: 100,
  onEvent: (event) => {
    if (event.type === "tick_end") process.stdout.write(".");
  },
});
```

That's the whole entry point. Everything else (rules, memories, persistence) is hooked in as services.

---

## Failure Modes

- **Provider outage**: pi-agent emits error event; engine pauses world and retries with backoff
- **Invalid tool call**: pi-agent schema validation catches; `beforeToolCall` returns block; character receives feedback, tries again
- **Budget exceeded**: characters with personal budgets start refusing tools; when global budget hit, pause and prompt user
- **Conflicting concurrent actions**: deterministic resolution via `(priority, birth_tick, rng_seed)` sort
- **Rule ambiguity**: soft-rule default; flagged in `compiler_notes` for user review

---

## Why Not Python / Pydantic AI

Considered earlier. Rejected because:
- Python backend + TypeScript frontend = two ecosystems, shared types require codegen
- Pydantic AI is Python-first; TypeScript support secondary
- Our dashboard is inherently web (TypeScript), and we want shared types with backend
- pi-agent's API (beforeToolCall, event stream) is actually cleaner than Pydantic AI's for our use case

Python would still work. Just not as clean.

---

## Dependencies

```json
{
  "dependencies": {
    "@mariozechner/pi-agent-core": "latest",
    "@mariozechner/pi-ai": "latest",
    "better-sqlite3": "^11",
    "drizzle-orm": "^0.30",
    "commander": "^12",
    "zod": "^3",
    "ws": "^8",
    "next": "^15"
  }
}
```

Install: `npm i -g chronicle-sim` and `chronicle` CLI is on PATH.

---

## Bottom Line

pi-agent is the right substrate. It gives us model-agnosticism, stateful characters, tool hooks, event streams — the exact primitives for a simulation framework. Going all-TypeScript unifies the stack.

Next design docs reference TypeScript APIs. Schema stays the same (it's just SQL).
