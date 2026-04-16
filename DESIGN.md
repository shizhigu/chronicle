# Chronicle — A Configurable Social Simulation Substrate

## The One-Line Vision

**Anyone can describe a world in natural language and watch it unfold with AI agents as inhabitants.**

Not a single scenario. A framework. Users bring the scenario; the system runs it.

---

## What We're NOT Building

- ❌ A Smallville clone (pre-scripted town)
- ❌ A Survivor clone (fixed format)
- ❌ A Sims clone (proprietary engine, specific mechanics)
- ❌ A research toolkit that needs Python knowledge (like Concordia)
- ❌ A chatbot pen where AI "roleplay" (no world state)

## What We ARE Building

- ✅ A **configurable substrate**: any world, any rules, any cast
- ✅ **Natural language all the way down**: config, rules, characters, interventions
- ✅ **Persistent agent instances**: each character = one long-running AI mind
- ✅ **CLI-first, Claude Code-guided**: onboard with an AI agent, run from terminal
- ✅ **Live animated rendering**: 2D visual that feels alive, not logs
- ✅ **Reproducible + shareable**: every run is a chronicle someone else can fork

---

## The Three Layers

```
┌────────────────────────────────────────────────────────┐
│ 1. CONFIG LAYER  (everything is natural language)      │
│                                                         │
│  "A post-apocalyptic trading post. 8 survivors, each   │
│   with a secret. Resources scarce. Every night someone │
│   disappears. Find out why."                            │
│                                                         │
│  ↓ CLI compiles this into:                              │
│  - world_setting.md                                     │
│  - character_personas.json                              │
│  - rules.yaml (compiled from natural language)          │
│  - initial_scene.md                                     │
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│ 2. SIMULATION LAYER  (SQLite + agent pool)              │
│                                                         │
│  World DB ←→ Tick Scheduler ←→ Rule Enforcer            │
│              ↓                                          │
│        Agent Pool (persistent Claude Agent SDK sessions)│
│              ↓                                          │
│        Action Validator ←→ Event Bus                    │
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│ 3. OBSERVATION LAYER  (live + replayable)               │
│                                                         │
│  Web frontend (Next.js + Canvas):                       │
│  - 2D map view (characters move, talk, interact)        │
│  - Timeline (every event, scrubbable)                   │
│  - Agent inspector (memory, mood, relationships)        │
│  - God interface (inject events mid-run)                │
│  - Export (video, transcript, forkable config)          │
└────────────────────────────────────────────────────────┘
```

---

## Critical Design Decisions

### Decision 1: Agent Runtime → **pi-agent (TypeScript)**

We use [`@mariozechner/pi-agent-core`](https://github.com/badlogic/pi-mono) + `@mariozechner/pi-ai`.

Why pi-agent:
- **Model-agnostic** via the `pi-ai` unified API (Anthropic/OpenAI/Google/local). No vendor lock-in.
- **Stateful Agent class**: `agent.state.messages` persists across ticks → same context = same character
- **`beforeToolCall` / `afterToolCall` hooks**: perfect injection point for rule enforcement
- **Event streaming**: tick events flow naturally to the dashboard via subscribe
- **Lightweight**: pure TypeScript, 50+ agents in one Node process
- **SessionId caching**: automatic Anthropic prompt caching between ticks

**Each character gets a pi-agent `Agent` instance:**
```typescript
const marcus = new Agent({
  initialState: {
    systemPrompt: character.persona + world.sharedContext,
    model: getModel(character.provider, character.modelId),
    thinkingLevel: "low",
    tools: compileWorldTools(world, character),
    messages: deserializeHistory(character.sessionStateBlob),
  },
  sessionId: `chr_${world.id}_${character.id}`,
  beforeToolCall: async ({toolCall, args}) =>
    ruleEnforcer.validate(character, toolCall, args),
  afterToolCall: async ({toolCall, result}) =>
    eventLog.append(character.id, toolCall, result),
});
```

Why not Claude Agent SDK: locks to Anthropic.
Why not Pydantic AI (Python): splits language across stack.
Why not Claude Code subagents: too heavy per character (~$0.50/invocation).

See `docs/AGENT_RUNTIME.md` for full details.

### Decision 2: Database → **SQLite + event-sourced log**

Everything is in one file (`world.db`). Schema below.

Why event-sourced:
- Every action is an append-only record
- State is derived from replaying events
- Time travel / rewind for free
- Reproducible: same seed + same events = same outcome
- Shareable: send one .db file = entire chronicle

### Decision 3: Rule Representation → **Three-tier rule system**

This is the hardest problem. Rules come in from users as natural language. They have to become enforceable in a DB.

Three tiers, every rule classified into one:

**Tier A: Hard rules** (engine-enforced, impossible to violate)
- "Each agent can do one action per tick"
- "Movement requires being alive"
- "Resources can't go negative"
- Implementation: SQL constraints + pre-action validation

**Tier B: Soft rules** (agents know, can violate, consequences tracked)
- "Killing others is taboo"
- "Lying damages reputation"
- "Elders are respected"
- Implementation: injected into agent system prompts; violations logged; reputation effects

**Tier C: Economic rules** (enforced but agents choose timing)
- "Speaking costs 1 token"
- "Each move burns 2 energy"
- "Trading has no cost"
- Implementation: action cost table, deducted on execution

When a user writes a rule in natural language, an LLM compiler:
1. Classifies it into A/B/C
2. Generates enforcement logic (SQL constraint, prompt injection, or cost formula)
3. Stores both the natural-language form AND compiled form

If the compiler is unsure, it asks the user (via their Claude Code) for clarification.

### Decision 4: Natural Language Config → **Structured via LLM compilation**

User writes:
```
8 survivors on a post-apocalyptic trading post.
Resources scarce. Every night someone disappears.
There's a murderer among them.
```

CLI compiles this via Claude into:
```yaml
world:
  setting: "post-apocalyptic trading post"
  scale: small (8 agents, 1 location cluster)
  atmosphere: tense, suspicious
  
characters: [8 archetypes generated with balanced traits, one flagged as
             hidden_role=murderer in private state]

resources:
  food: { initial: 40, daily_consumption: 8 }
  water: { initial: 30, daily_consumption: 8 }
  ammunition: { initial: 10 }

time:
  tick_duration: "1 hour in-world"
  day_night_cycle: 24 ticks
  
rules:
  - tier: A, description: "One action per tick"
  - tier: B, description: "Agents have incomplete information about others"
  - tier: B, description: "Murderer knows their role, others don't"
  - tier: A, description: "Each night, IF murderer chooses target AND target is alone, target is eliminated"

events:
  - trigger: "night_begins", effect: "visibility reduced, murderer gets action slot"
  - trigger: "agent_found_dead", effect: "broadcast to all, tension +20"

initial_scene: |
  "Day 1. Morning. You wake up in the trading post you all share.
   Everyone is here. Food is running low. You don't fully trust anyone."
```

The user can review/edit this compiled form, or just hit go. For most users, they never see the YAML — they just describe what they want.

---

## The Tick Lifecycle

One tick = one unit of simulated time. Configurable per world.

```
Tick N begins
  │
  ├─► Engine computes observable state per agent (what each sees/hears)
  │
  ├─► For each live agent (parallelizable):
  │     1. Package observation + memory + goals → prompt
  │     2. Invoke agent Session → action intent
  │     3. Validate action against rules
  │     4. Queue valid actions for resolution
  │
  ├─► Resolution phase (deterministic):
  │     1. Sort actions by priority (or randomize)
  │     2. Apply each action's effects to world state
  │     3. Handle conflicts (two agents grab same resource)
  │     4. Emit events (spoken message → visible to hearers, etc.)
  │
  ├─► Reflection (every N ticks, e.g. 10):
  │     Each agent gets a reflection prompt: "summarize what just happened,
  │     what you've learned, update your goals"
  │
  ├─► God check:
  │     Any user interventions queued? Apply them.
  │
  ├─► State snapshot + event log → persist to SQLite
  │
  ├─► Broadcast state delta → rendering frontend via WebSocket
  │
Tick N+1 begins
```

**Cost accounting:** Every LLM call has a token cost logged. A world can have a "God's budget" — if exceeded, world pauses until user refills (real-time manual control over pace and spend).

---

## The CLI Experience

User never writes JSON. They talk to Claude Code, which calls our CLI.

### First run

```
$ chronicle init

Chronicle is a tool for running social simulations with AI agents.

To create your first world, I need you to describe what you want to simulate.
You can describe anything: a kingdom, a classroom, a spaceship crew, a
group chat. Be as vague or specific as you like.

What would you like to simulate?
```

(Actually — the user's Claude Code reads this prompt and asks the user for the description, potentially with follow-up questions. The CLI provides conversational scaffolding.)

### Creation

```
$ chronicle create-world --from-description "8 survivors on an island"

✓ Parsing description...
✓ Generated 8 characters with diverse personas:
   - Marcus (military, stoic, hiding something)
   - Elena (doctor, pragmatic)
   - ... [etc]
✓ Created 3 locations: beach, forest, mountain
✓ Identified 5 rules
✓ Set up resource economy

World ID: chr_9k8m3n
Open dashboard: http://localhost:7070/c/chr_9k8m3n

Next steps:
   chronicle review-characters chr_9k8m3n    # see/edit personas
   chronicle run chr_9k8m3n --ticks 100     # run 100 ticks
   chronicle watch chr_9k8m3n               # live observe
```

The next-steps hints are meant to be readable by the user's Claude Code, which proactively offers them as buttons.

### Running & intervening

```
$ chronicle run chr_9k8m3n --live
[Tick 47] Marcus suggested moving to higher ground.
[Tick 47] Elena disagreed, cited medical supplies in beach camp.
[Tick 47] Tension increased: Marcus ↔ Elena.
[Tick 48] ...

$ chronicle intervene chr_9k8m3n --event "A storm hits the island"
✓ Event queued. Will trigger next tick.
```

### Fork and share

```
$ chronicle export chr_9k8m3n --out my_run.chronicle
✓ Exported: world config + full event log + final state (2.3 MB)

# someone else:
$ chronicle import my_run.chronicle
$ chronicle replay <id>           # watch the same run play back
$ chronicle fork <id> --at-tick 50 --new-event "Aliens land"  # branch from tick 50
```

---

## The Rendering

This is where it becomes delightful. Not just functional.

### Primary view: 2D map

- Top-down pixel-ish style (think Stardew Valley aesthetic but simpler)
- Each character = a sprite with an emoji face showing current mood
- Speech bubbles appear ABOVE character, fade after 8 seconds
- Characters walk smoothly between tiles (interpolated animation)
- Background color subtly shifts based on world "mood" (tension → red tint, harmony → warm gold)

### Overlays (toggleable)

- **Relationship web**: faint lines connecting agents; thickness = bond strength; red = hostile, green = friendly
- **Resource heatmap**: tiles colored by resource density
- **Knowledge bubbles**: show which agents know which secrets (hover over agent to see)
- **Cone of vision**: if fog-of-war rules, show what each agent currently perceives

### Timeline

Below the map, a scrubbable timeline:
- Every event is a tick mark
- Colored by event type (talk = blue, fight = red, love = pink, discovery = gold)
- Hover: snippet of what happened
- Click: jump to that moment
- Scrub: rewind world state

### Agent inspector (right sidebar)

Click any agent:
- Current mood + physical state (energy, health, hunger)
- Recent memories (last 5 significant events from their POV)
- Known relationships
- Current goal
- "What they would say right now if asked" (hover-to-generate, cheap reflection)

### God interface (top bar)

- Pause/play
- Speed: 0.25x, 1x, 4x, 16x
- **Inject event**: text input → natural language event that happens next tick
- **Modify rule**: change a rule mid-game
- **Spawn character**: add new agent with description
- **Kill character**: remove agent
- **Fork here**: save current state as a branch

---

## The Data Model

See `SCHEMA.sql` for full DDL. Key tables:

- `worlds` — top-level config, system prompts, current tick
- `agents` — each AI character, their persona, traits, current state
- `agent_memory` — episodic memories per agent (event-sourced)
- `agent_sessions` — references to Claude Agent SDK Session IDs for persistence
- `locations` — places in the world (graph structure)
- `resources` — what exists where
- `rules` — natural language + compiled form + enforcement type
- `actions` — definitions of what's allowed (per-world configurable)
- `events` — append-only log of everything that happened
- `messages` — speech/communication events
- `relationships` — agent-agent bonds
- `god_interventions` — user-injected events
- `tick_snapshots` — full state at key ticks for replay/fork

**Key insight**: the world is fully reconstructable from `worlds` + `events`. Everything else is derived state that we cache for speed.

---

## Cost Model

Honest numbers:

| Tick budget | Cost | What you get |
|---|---|---|
| 100 ticks, 5 agents, Haiku-only | $0.50 | An afternoon of drama |
| 500 ticks, 10 agents, mixed | $10 | A short novel's worth |
| 5000 ticks, 20 agents, Sonnet for reflection | $150 | A civilization arc |

Default: Haiku for action decisions (cheap), Sonnet for reflections every 20 ticks. User can override.

Users bring their own API key (we don't proxy / don't eat their costs). We provide a cost estimator before running.

---

## Example Scenarios (ship with `chronicle examples`)

1. **Desert Island** — 8 survivors, scarce resources, suspect murder mystery
2. **High School Drama** — 30 students, cliques form, gossip spreads
3. **Startup Founders** — 5 co-founders, must ship product before runway ends
4. **Royal Court** — Medieval politics, succession crisis, conspiracies
5. **Group Chat** — Pure text, 10 people in a Discord, no physical world
6. **Philosophers at a Dinner** — 5 famous philosophers debate over 10 courses
7. **First Contact** — Human crew meets alien crew, no shared language
8. **Apocalypse Cult** — Charismatic leader forms a group, watch it evolve

Each example is a `.chronicle` file (natural-language config). Users open it, tweak, run.

---

## What Makes This Viral

1. **Every run is unique shareable content.** Users screenshot/video their chronicles, share to social. Each post is also a product ad.

2. **Fork culture.** "Look what happened in my version" is a naturally viral format.

3. **God-mode is inherently satisfying.** Humans love playing god. Sims sold 200M+ copies.

4. **Low barrier.** Natural language config means a non-coder can set up complex experiments.

5. **Compelling to multiple audiences:**
   - Researchers (social science, economics)
   - Writers (story idea generator)
   - Educators (simulate historical events)
   - Gamers (let AI act out your wildest scenarios)
   - Content creators (endless material for YouTube/Twitch)

---

## What Makes This Hard

1. **Rule compilation is fuzzy.** "Agents should be suspicious of each other" is hard to enforce mechanically. We need careful taxonomy + graceful degradation (when compiler isn't sure, ask or default to soft rule).

2. **Emergence is probabilistic.** Same config can produce vastly different outcomes. Good — that's the point. Must communicate this clearly so users don't expect deterministic behavior.

3. **LLM cost at scale.** Need aggressive cheap-model usage + caching + rate limiting.

4. **Agent consistency over long runs.** After 500 ticks, does character X still feel like character X? Memory management critical.

5. **Rendering is non-trivial.** Making it beautiful requires taste + iteration. Possibly hire artist for sprite set.

---

## Roadmap

Not MVP. Each milestone is a fully usable product.

- **v0.1 "Chronicle"** — CLI + SQLite + agent runtime + text-only rendering. One example (group chat). Works end-to-end.
- **v0.2 "Visual Chronicle"** — Add 2D map, sprites, animated rendering. Three examples.
- **v0.3 "Forkable"** — Export/import, fork at tick, replay. Share URL.
- **v0.4 "Public"** — Hosted service at chronicle.sh. Gallery of user-shared chronicles.
- **v1.0 "Open Platform"** — Plugin system for custom tools, rule types, rendering skins.

---

## Next Steps

1. Finalize SQLite schema (see `schema/SCHEMA.sql`)
2. Prototype agent runtime with Claude Agent SDK (see `engine/`)
3. Write CLI surface (see `cli/README.md`)
4. Build rule compiler (see `engine/rule_compiler.md`)
5. Ship first working world (group chat scenario, 5 agents, 50 ticks)

---

**Project name**: Chronicle
**Tagline**: *Every run is a world's first history.*
