# Rule Compiler — The Hardest Problem

## The Problem

User writes rules in natural language:
- "Agents can't kill each other without consequences."
- "Only adults can vote."
- "Secrets should spread slowly through gossip."
- "Food depletes by 1 per agent per day."
- "If three agents agree, they form a binding pact."

We need to translate these into machine-enforceable logic that works in the DB + engine.

This is the single thing that will make or break the framework.

---

## The Three-Tier Taxonomy

Every rule falls into exactly one tier. The compiler's first job is classification.

### Tier A — Hard Rules (engine-enforced, impossible to violate)

These are physical laws. Agents literally cannot break them; the engine won't let them.

**Examples:**
- "One action per tick" → engine rejects a second action
- "Movement requires being alive" → can't move if dead
- "Resources can't be negative" → DB constraint
- "Can only speak to agents in same location" → pre-action validation
- "Food depletes by 1 per tick per agent" → automatic tick effect

**Characteristics:**
- Objective conditions (alive, quantity, location)
- No judgment required
- Express as: predicate + action on violation

**Implementation**: SQL constraint OR pre-action validator function.

### Tier B — Soft Rules (norms, agents can violate, consequences tracked)

These are social norms. Agents are told about them, they can choose to break them, but there are consequences.

**Examples:**
- "Stealing is taboo"
- "Elders are respected"
- "Strangers should be greeted politely"
- "Killing someone destroys your reputation"
- "Breaking a promise damages trust"

**Characteristics:**
- Require judgment (what counts as "stealing"? context matters)
- Violation has emergent effects (other agents react)
- Best enforced through social dynamics, not engine

**Implementation**:
1. Inject norm into every agent's system prompt: "In this world, stealing is strongly taboo."
2. After each action, run a cheap LLM judge: "Did this action violate [norm X]?"
3. If yes: log violation, notify witnesses (other agents in range), adjust reputation/relationships
4. Witnesses remember and react in future turns

### Tier C — Economic Rules (costs and conversions)

These are action-cost tables and conversion formulas.

**Examples:**
- "Speaking costs 1 energy"
- "Each movement burns 2 tokens"
- "Crafting a shelter requires 10 wood + 5 stone"
- "Teaching transfers a skill but costs 20 energy from teacher"

**Characteristics:**
- Arithmetic over agent/world state
- No ambiguity once costs defined

**Implementation**: Cost formulas applied on action execution. Agents see costs in their tool descriptions.

---

## The Compiler Pipeline

```
Natural Language Rule
        ↓
[1. Classifier]    → tier: hard | soft | economic | ambiguous
        ↓
[2. Parser per tier] → structured enforcement definition
        ↓
[3. Sanity check]   → "does this rule make sense in this world?"
        ↓
[4. Persist]        → stored in `rules` table with natural + compiled forms
```

### Step 1: Classifier prompt

```
You are classifying a simulation rule into one of three tiers:

TIER A (HARD): Physical/engine-enforced law. Impossible to violate.
Examples: "can't move if dead", "resources can't be negative"

TIER B (SOFT): Social norm. Agents can choose to violate, with consequences.
Examples: "stealing is taboo", "elders are respected"

TIER C (ECONOMIC): Cost or conversion formula.
Examples: "speaking costs 1 energy", "shelter needs 10 wood"

Rule: {rule_text}

Classify as A, B, or C. If unclear or multi-tier, output AMBIGUOUS with explanation.
```

### Step 2: Tier-specific parsers

**For Tier A** — extract predicate + on_violation:
```
Rule: "{rule}"

Output JSON:
{
  "predicate": "alive=true AND target.distance <= 5",
  "applies_to_action": "speak",  // or "all"
  "on_violation": "reject" | "auto_correct" | "penalty:...",
  "check_when": "pre_action" | "continuous"
}
```

**For Tier B** — extract norm text + detection + consequence:
```
Rule: "{rule}"

Output JSON:
{
  "norm_text": "In this world, <one sentence norm>",
  "detection_criteria": "An action violates this if: <specific conditions>",
  "consequence_description": "When violated, <what happens>",
  "affected_relationships": ["trust", "respect"],
  "reputation_delta_on_violation": -10
}
```

**For Tier C** — extract action + cost formula:
```
Rule: "{rule}"

Output JSON:
{
  "applies_to_action": "speak",
  "costs": {
    "energy": 1,
    "tokens": 5
  },
  "conversion": null  // or for crafting: {"inputs": {...}, "outputs": {...}}
}
```

### Step 3: Sanity check

After compilation, ask an LLM:
```
World context: {world.description}
Rule: {rule_text}
Compiled form: {compiled_json}

Is the compiled form consistent with the rule?
Does it make sense in this world?
Any edge cases the compiler might have missed?
```

If issues flagged, either:
- Auto-correct for minor issues
- Present to user via Claude Code for confirmation

---

## Ambiguous Rules → Graceful Degradation

Some rules don't cleanly fit. Strategy:

**Default to Tier B (soft)** when unsure. Soft rules are the most forgiving — they work even if imperfectly enforced because agents have context and can adapt.

**Ask user for clarification** via CLI:
```
⚠️ Rule needs clarification: "The strong should protect the weak"

I'm not sure if this is:
  [A] A hard rule (if violated, engine auto-protects weak agents)
  [B] A soft norm (agents know it, can violate, social consequences)
  [C] An economic rule (strength converts to protection somehow)

My best guess: [B] Soft norm. Agents will have this in their persona and
witnesses will react to violations.

Confirm [B] or clarify?
```

The user's Claude Code handles this dialog transparently.

---

## Dynamic Rules

Rules can be added mid-simulation. Two paths:

**User (god) injects:**
```bash
chronicle rule-add chr_9k8m3n --text "From now on, lying is a capital offense"
```

**Agent proposes** (if the world allows):
Agents have a `propose_rule` tool. If enough agents agree, it becomes a rule. This is how laws emerge bottom-up.

```python
@tool
def propose_rule(description: str):
    """Propose a new rule for the group. Others must vote to accept.
    Requires a 2/3 majority of witnesses to become law."""
```

When proposed, a vote event is triggered. If passed, compile and activate.

---

## Rule Conflicts

Two rules might contradict:
- Rule 1 (priority 100): "Speaking is free"
- Rule 2 (priority 200): "Speaking costs 1 energy"

Resolution: **Higher priority wins.** Rules have a `priority` field (default 100). User can set explicit priorities in the config. When rules conflict, the highest-priority active rule applies.

Also: rules can have **scope**:
- Global: applies to all agents
- Location: only in a specific place
- Role: only for agents with a specific tag/role
- Time: only during certain ticks (e.g., "Night rules only apply 18:00-06:00")

---

## Example Compilation Walkthrough

**Input**: *"Agents in the temple can't carry weapons."*

**Classification**: Tier A (hard rule) — has clear location + action condition.

**Compiled**:
```json
{
  "tier": "hard",
  "scope": {
    "location": "temple"
  },
  "predicate": "inventory.contains_type('weapon')",
  "applies_to_action": ["move", "enter"],
  "on_violation": "auto_correct:drop_weapons_at_boundary",
  "notification": "Guards at the temple gate confiscate your weapons."
}
```

**Runtime behavior**: When an agent tries to move to the temple with a weapon, the engine forces them to drop it at the boundary and sends a notification message.

---

**Input**: *"Cheating at dice is shameful."*

**Classification**: Tier B (soft norm) — requires judgment.

**Compiled**:
```json
{
  "tier": "soft",
  "norm_text": "In this world, cheating at dice is considered shameful and dishonest.",
  "detection_criteria": "An agent cheats if they use hidden information or manipulation during a dice game to favor themselves.",
  "consequence_description": "Witnesses lose trust in the cheater. Severe reputation damage.",
  "affected_relationships": ["trust", "respect"],
  "reputation_delta_on_violation": -25,
  "witnesses_remember_for_ticks": 100
}
```

**Runtime behavior**: When a dice-game action completes, a lightweight LLM judge examines it. If cheating detected, all witnesses get a memory noting the cheating, their `trust` relationship value drops, and the cheater's reputation is reduced. The cheater's persona might even update: *"You have been caught cheating at dice. Others are wary of you now."*

---

**Input**: *"Training someone costs the trainer 20 energy and transfers skill."*

**Classification**: Tier C (economic rule).

**Compiled**:
```json
{
  "tier": "economic",
  "applies_to_action": "train",
  "costs": {
    "energy": 20
  },
  "effects": {
    "source_agent": {"skill_x": -0.1},
    "target_agent": {"skill_x": +0.5}
  },
  "precondition": "source_agent.skill_x > 0.2"
}
```

**Runtime behavior**: When `train(target)` action is called, engine deducts 20 energy from trainer, adds skill to target (minus a bit from trainer — skill isn't free). If trainer has insufficient skill or energy, action rejected.

---

## Special Case: Emergent Rules

The most interesting behavior is when agents start creating their own rules via `propose_rule`. These go through the same compiler, then become part of the world.

**Scenario**: Three agents form a trade alliance and declare, "We won't trade with outsiders."

Their proposal goes through the compiler → becomes a Tier B rule scoped to those three agents. Next tick, if any of them tries to trade with an outsider, an LLM judge evaluates and records violation.

This is how **institutions emerge**. Not hand-coded. Not pre-defined. Agents create them in response to their situation.

---

## The Meta-Rule

There is one rule the compiler never removes:

> **"No rule may grant an agent infinite action budget."**

This prevents a buggy self-proposed rule from letting an agent monopolize resources. Hard-coded engine guard.

---

## Iteration Plan

1. **Ship the classifier first.** Test on 20 example rules across genres. Measure classification accuracy.
2. **Ship Tier A compiler.** Easiest, most valuable (physical laws).
3. **Ship Tier C compiler.** Second-easiest (just cost tables).
4. **Ship Tier B compiler + judge.** Hardest, requires LLM judge tuning.
5. **Ship rule-proposal / voting.** Enables emergence.

Each stage ships with its own test harness. Compiler reliability is measurable.
