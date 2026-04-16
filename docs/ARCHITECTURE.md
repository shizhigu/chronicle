# Architecture — How the Code Actually Fits Together

## The Monorepo

Chronicle is an npm workspaces monorepo. Packages are small and single-purpose. Type safety flows through the graph without duplication.

```
chronicle/
├── package.json               ← workspaces root
├── tsconfig.base.json         ← shared strict TS config
├── schema/SCHEMA.sql          ← canonical database DDL
├── packages/
│   ├── core/                  ← types, ids, rng (zero deps on DB/LLM)
│   ├── engine/                ← tick loop, store, rules, events, narrative
│   ├── runtime/               ← pi-agent integration, tool compilation
│   ├── compiler/              ← natural lang → world / rules (LLM-driven)
│   ├── cli/                   ← chronicle command — user entrypoint
│   └── dashboard/             ← React Router v7 live UI
└── docs/                      ← all the design docs
```

## Dependency Graph (strict)

```
        ┌─────────────┐
        │    core     │ ← shared types, ids, rng
        └──────▲──────┘
               │
      ┌────────┴────────┐
      │                 │
      ▼                 ▼
┌──────────┐     ┌────────────┐
│  engine  │     │  compiler  │
└────▲─┬───┘     └─────▲──────┘
     │ │               │
     │ │               │
     │ └───► ┌─────────┴──────┐
     │      │    runtime      │
     │      └────────▲────────┘
     │               │
     │          ┌────┴─────┐
     └──────────┤          ▼
                │      ┌──────┐
                │      │ cli  │
                └──────┴──────┘

dashboard/ depends only on core + engine (for live replay queries via WebSocket)
```

**Rules:**
- `core` never imports from anything internal
- `engine` imports only from `core`
- `compiler` imports from `core` and `engine` (for type compatibility on persist())
- `runtime` imports from `core` and `engine` (uses WorldStore, RuleEnforcer)
- `cli` imports from all of `core/engine/runtime/compiler`
- `dashboard` imports from `core` and `engine`

No cycles. Ever.

## Data Flow (One Tick)

```
┌──────────┐   1. load live agents
│   CLI    │─────────────────────────────────┐
└──────────┘                                 │
                                             ▼
                                    ┌──────────────────┐
                                    │     Engine       │
                                    │  (tick loop)     │
                                    └───────┬──────────┘
                        2. build             │
                        observation          │
                        per agent     ┌──────▼──────────┐
                                      │ ObservationBuild│
                                      └──────┬──────────┘
                        3. durable memory    │
                        is already in        │
                        system prompt        │
                        (injected at         │
                        session start via    │
                        MemoryFileStore)     │
                                             │
                        4. parallel          │
                        LLM calls    ┌───────▼─────────────┐
                                      │    AgentPool         │
                                      │  (pi-agent sessions) │
                                      └───────┬─────────────┘
                                              │ (tool call chosen)
                        5. beforeToolCall     │
                           enforcement ┌──────▼──────────┐
                                       │ RuleEnforcer    │
                                       └──────┬──────────┘
                                              │ ok → execute
                        6. tool execute ┌─────▼──────────┐
                                       │   Tool fn       │
                                       │  (mutates DB)   │
                                       └──────┬──────────┘
                                              │
                        7. log event   ┌──────▼──────────┐
                                       │   WorldStore    │
                                       │  (events table) │
                                       └──────┬──────────┘
                                              │
                        8. broadcast   ┌──────▼──────────┐
                                       │   EventBus      │
                                       └──────┬──────────┘
                                              │
                        9. god / catalyst     │
                        / reflection / tick   │
                        advance        ┌──────▼──────────┐
                                       │  Engine cleanup │
                                       └─────────────────┘
```

## Package: core

**Role**: lingua franca.

Contains TypeScript interfaces that every other package uses:
- `World`, `Agent`, `Location`, `Resource`, `Rule`, `ActionSchema`, `Event`, `Message`, `Relationship`, `Agreement`, `GodIntervention`
- `Observation`, `ProposedAction`, `TurnResult`, `ValidationResult`

(No `AgentMemory` — durable memory moved out of SQLite to per-character
markdown files managed by `MemoryFileStore`. See the engine package.)

Plus:
- `generateId(prefix)`, `worldId()`, `agentId()`, etc. — nanoid-based short IDs
- `createRng(seed)` — deterministic Mulberry32 RNG for reproducible runs

**Zero runtime deps** beyond `nanoid`. Never imports `better-sqlite3` or pi-agent.

## Package: engine

**Role**: simulation orchestration.

Key classes:
- `WorldStore` — DB access (drizzle + better-sqlite3). Everything DB-related goes through here.
- `Engine` — the tick loop. Uses `AgentRuntimeAdapter` (injected) so it doesn't know about pi-agent directly.
- `RuleEnforcer` — evaluates hard/soft/economic rules against proposed actions.
- `EventBus` — in-process pub/sub. Emits structured events for UI/logging.
- `ObservationBuilder` — computes per-agent observations.
- `MemoryFileStore` — per-character markdown memory file, curated by the agent via `memory_add`/`memory_replace`/`memory_remove`. Injected as a frozen snapshot into the system prompt at session start (hermes-agent pattern). No embeddings, no retrieval scoring.
- `ReflectionService` — triggers periodic deep reflections; writes each reflection as a new entry into the character's memory file.
- `DramaDetector` — scores recent ticks for dramatic activity.
- `CatalystInjector` — injects prompted "something happens" events when drama low.
- `GodService` — queues + applies user interventions.

**`AgentRuntimeAdapter` interface** (defined in `engine.ts`): the contract runtime packages must implement. Keeps engine decoupled from pi-agent.

## Package: runtime

**Role**: pi-agent integration.

Exports:
- `AgentPool` — implements `AgentRuntimeAdapter` using pi-agent `Agent` instances
- `compileWorldTools(world, character, store, schemas)` → `AgentTool[]`

**Design note**: we lazy-load `@mariozechner/pi-agent-core` so the runtime package itself can be imported in unit tests without the pi-agent dependency present. The real dependency kicks in when `AgentPool.hydrate()` is called.

Each pi-agent `Agent` instance:
- Has persistent `state.messages`
- Has `beforeToolCall` hook wired to `RuleEnforcer`
- Has `afterToolCall` wired to `EventBus`
- Subscribes `message_update` events to forward character "thinking" to dashboard

## Package: compiler

**Role**: natural language → structured config.

Exports:
- `WorldCompiler.parseDescription(description)` → `CompiledWorld`
- `WorldCompiler.persist(store, compiled, opts)` → `worldId`
- `RuleCompiler.compile(worldId, descriptions)` → `Rule[]`
- `createLlm()` → `Llm` (thin wrapper over `@mariozechner/pi-ai`)

**Key principle**: single-shot LLM calls. No agents, no tools, no state. Just prompt → structured JSON via Zod validation.

## Package: cli

**Role**: user-facing entrypoint.

Commands:
- `init` — welcome + NEXT_STEPS for Claude Code onboarding
- `create-world --desc "..."` — compile & persist
- `list` — list chronicles on this machine
- `run <id> [--ticks N] [--live]` — advance simulation
- `watch <id>` — recent event tail
- `intervene <id> --event "..."` — queue god event
- `export <id> --out path` — JSON bundle
- `import path` — reimport JSON bundle
- `dashboard <id> [--port N]` — (v0.2: launches React Router app)
- `config [--set k=v]` — local config mgmt

**Output convention**: every command prints human-readable output, then a `NEXT_STEPS` block that Claude Code (or any AI co-host) parses to propose follow-ups.

## Package: dashboard

**Role**: live visual rendering.

Built on **React Router v7** (Remix lineage). Routes:
- `/` home
- `/c/:worldId` — chronicle page (layout with tabs)
  - index → live 2D map
  - `/gazette` → newspaper view
  - `/whispers/:agentId` → character POV feed
  - `/reel` → highlight reel
- `/r/:worldId` — replay mode (read-only)
- `/gallery` — public chronicle browsing
- `/api/ws/:worldId` — WebSocket endpoint to Engine's EventBus

## The Initialization Sequence

When user runs `chronicle run <id> --live`:

```
CLI run command
  │
  ├─ load config (api keys etc)
  ├─ open WorldStore at ~/.chronicle/worlds.db
  ├─ load World row
  │
  ├─ new EventBus
  ├─ new RuleEnforcer(store, world)
  ├─ new AgentPool({ store, ruleEnforcer, events })
  │
  ├─ new Engine({ dbPath, worldId, runtime: agentPool, ... })
  ├─ await engine.init()
  │    └─ hydrates AgentPool:
  │        for each live character:
  │          - compile its tools from action_schemas
  │          - deserialize its session_state_blob
  │          - create pi-agent Agent with beforeToolCall hook
  │
  ├─ subscribe to engine.bus for --live output
  │
  ├─ await engine.run({ ticks: 50 })
  │    └─ for tick N in [current+1 .. current+50]:
  │         ... observation → decision → rule check → tool exec → event log
  │
  └─ engine.shutdown()
      └─ persists all session_state_blobs to DB
```

Everything is **resumable**. Kill the process, restart, and you pick up at the exact same tick.

## Testing Strategy

- **core**: pure functions, trivial unit tests (ids, rng reproducibility)
- **engine**: integration tests with in-memory SQLite (`new WorldStore(':memory:')`) + mock runtime adapter
- **runtime**: unit tests for tool compilation + dispatch; integration tests use a mock `pi-agent` Agent
- **compiler**: unit tests with mock `Llm` returning canned JSON
- **cli**: E2E test that runs actual CLI commands against temp DB
- **dashboard**: React component tests + one E2E happy-path in Playwright

See `docs/TESTING.md` for detailed test plan.

## Adding a New Component

1. **New table**: add to `schema/SCHEMA.sql` AND `packages/engine/src/db/schema.ts` drizzle definition AND `packages/core/src/types.ts` interface. Add CRUD methods to `WorldStore`.
2. **New action type**: add to an example world's `actions` block. The tool compiler will pick it up automatically; if it has special logic, add a case in `compileSchemaAsTool` in `runtime`.
3. **New rule tier**: update `RuleTier` union in `core/types.ts`, add column(s) to `rules` table, teach `RuleCompiler` to produce it, teach `RuleEnforcer` to evaluate it. Three-file touch.
4. **New CLI command**: add file to `packages/cli/src/commands/`, register in `index.ts`.
5. **New rendering surface**: add route file to `packages/dashboard/app/routes/`, add entry in `routes.ts`.

## Why TypeScript Everywhere

- **Pi-agent is TypeScript-first** — using it from Python would require HTTP shim
- **Dashboard is JS** (React) — sharing types with backend is free
- **Type safety across packages** with `workspace:*` deps — no schema drift
- **One language for contributors** — lower barrier

Python was considered for data science workflows (drama benchmark analysis, etc.); we do those in Node.js with Arrow/DuckDB so we stay in one runtime.

## Performance Envelope

Targets for v0.1:
- `create-world` → returns < 20s for small worlds (8 agents)
- tick (10 agents, Haiku) → < 8s
- dashboard WebSocket delta → < 150ms
- SQLite size per 100-tick chronicle → < 3MB

Bottleneck is invariably the LLM. pi-agent + prompt caching + model tiering get us within budget.

## The Extension Boundaries

We invite plugins at three seams:
1. **Agent adapters** — implement `AgentRuntimeAdapter`, plug in any LLM system (not just pi-agent)
2. **Action schemas** — worlds define custom actions; tool compiler handles them generically
3. **Rendering surfaces** — dashboard routes are pluggable (future: theme packs)

These are the places external contributors can work without touching core engine logic.

## The One-Line Summary

**core** defines the nouns. **engine** runs the verbs. **runtime** makes the actors real. **compiler** turns prose into structure. **cli** is the human interface. **dashboard** is the viewer.

Each package is under 3k LoC. Each has a single reason to change. Each is testable in isolation.
