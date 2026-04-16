# Testing — How We Know This Works

## The Stakes

Chronicle simulates emergent systems. Emergent systems are notoriously hard to test — "did the right thing happen?" isn't binary.

We have to test at multiple levels: deterministic (code), semi-deterministic (simulations with seeded RNG), and qualitative (did drama actually emerge?).

Without rigorous testing, we ship AI slop. So we obsess.

---

## The Six Test Layers

```
┌──────────────────────────────────────────────┐
│ 6. Pre-release gauntlet                       │  manual + automated, 30min
├──────────────────────────────────────────────┤
│ 5. Drama quality benchmarks                   │  weekly, 2hr
├──────────────────────────────────────────────┤
│ 4. Scenario integration tests                 │  every commit, 10min
├──────────────────────────────────────────────┤
│ 3. End-to-end (install → first run)           │  nightly, 5min
├──────────────────────────────────────────────┤
│ 2. Integration (tick loop, DB, runtime)        │  every commit, 2min
├──────────────────────────────────────────────┤
│ 1. Unit (schema, rule compiler, types)        │  every save, <30s
└──────────────────────────────────────────────┘
```

---

## Layer 1 — Unit Tests

### Schema
- Can create/migrate DB from empty
- Every constraint enforces what it should
- Indexes exist where queries need them

### Core types
- TypeScript strict mode catches type errors

### Rule compiler
- 30+ canonical rule inputs → expected tier classification
- Hard rule compilation produces valid predicate strings
- Economic rule compilation produces valid cost formulas
- Soft rule compilation produces valid norm + detection text
- Ambiguous rules default to soft tier

### Action compiler
- Action schema → valid tool function
- Tool args match schema
- Cost deduction applies correctly

### Memory retrieval
- Ranking by recency × importance × relevance
- Top-K returns correct number
- No duplicates

### Tools
- Each tool validates args
- Each tool emits expected event

**Frameworks**: vitest.
**Target**: >85% coverage on `core`, `engine/rules`, `runtime/tools`.

---

## Layer 2 — Integration Tests

### Full tick cycle
- Fixture world with 3 agents
- Run tick → assert: all agents decided, events logged, state updated, DB persistence correct

### Agent persistence
- Create agent, run 5 ticks, kill process, restart
- Assert: agent's memory + persona + history exactly preserved

### Multi-agent parallel
- 10 agents, same snapshot, parallel decisions
- Assert: no state corruption, deterministic resolution order

### Rule enforcement pipeline
- Create rule, try action that violates, assert rejection
- Create rule, try action that satisfies, assert success
- Economic rule → cost applied correctly

### God intervention
- Queue intervention for tick N+2
- Run to N+3
- Assert: intervention applied at N+2, effects visible

### Fork
- Run world to tick 30
- Fork at tick 20 with modification
- Assert: fork starts from tick 20 state, modification applied

### Import/Export
- Export world → import fresh → assert: identical state
- Replay original events → assert: same state at end

---

## Layer 3 — End-to-End Tests

### Fresh install flow
1. Clean environment (no chronicle installed)
2. Run install script
3. Assert: `chronicle` on PATH
4. Run `chronicle create-world --desc "3 people on a raft"`
5. Assert: world created, file exists
6. Run `chronicle run <id> --ticks 10`
7. Assert: 10 ticks complete, events logged, no errors
8. Total time < 2 minutes (excluding LLM call time)

### Dashboard flow
1. Start engine
2. Connect WebSocket
3. Assert: initial state broadcast
4. Run 5 ticks
5. Assert: 5 tick deltas received in order

### Export → import → replay
1. Run a world to completion
2. Export
3. Import to a fresh database
4. Replay
5. Assert: identical event sequence, identical final state

**Run nightly + on every major PR.**

---

## Layer 4 — Scenario Integration Tests

For each canonical preset scenario (Dinner Party, Desert Island, Startup, etc.), a specific test:

### Dinner Party
- Run 50 ticks, 10 random seeds
- Metrics:
  - ≥1 speech event per tick on average (people talk)
  - At least 3 distinct characters make ≥5 actions (not a monologue)
  - ≥1 relationship value change in first 20 ticks
  - At least 2 characters end up with different moods than they started
  - No character actions rejected >30% of the time (rules aren't too strict)

### Desert Island
- Run 100 ticks, 10 seeds
- Metrics:
  - Resource consumption consistent with rule definitions
  - Characters move between locations at least 3x each
  - ≥1 conflict event (rule violation or argument)
  - Catalyst events fire when drama score low

### Startup
- Run 100 ticks, 5 seeds
- Metrics:
  - Project resources (code, funding) change over time
  - Characters have different roles (inferred from action patterns)
  - At least one "crisis moment" (budget near zero, bug, etc.)

**These catch regressions where "code still works but drama quality dropped."**

---

## Layer 5 — Drama Quality Benchmarks

Weekly, we run a **drama benchmark**:

1. 50 curated scenarios across genres (our test set)
2. Each scenario, 5 seeds, 100 ticks
3. For each run, compute:
   - Drama score (events with high impact / total events)
   - Character arcs (did characters change meaningfully?)
   - Surprise metric (how many novel utterances vs expected responses?)
   - Coherence (do character actions make sense given their persona?)
   - Narrative shape (tension arc — does drama rise/fall?)

### Scoring

Each metric scored 0-10 by:
- Automated: rules (count events, track state changes)
- Assisted: LLM judge evaluates qualitatively (Sonnet, with rubric)

### Pass criteria

- Median drama score > 6.0
- ≥80% of scenarios show character arcs
- ≥70% have narrative shape (not flat)

### If scores drop

- Investigate: did a model version change? Prompt drift? Rule bug?
- Never ship a release with score regression vs previous release.

### The human audit

Once a month, human review of 10 random runs:
- Are the characters believable?
- Is the dialogue good?
- Is the emergence interesting?

Human taste > metrics, ultimately.

---

## Layer 6 — Pre-Release Gauntlet

Before any public release (v0.1, v0.2, etc.):

### Automated gauntlet (30 min)
- All unit tests pass
- All integration tests pass
- All scenario tests pass
- Drama benchmarks meet thresholds
- E2E install test passes
- Documentation links checked

### Manual gauntlet (2 hours)
- Install on fresh Mac, fresh Ubuntu
- Do the user journey end-to-end
- Create 3 different scenarios
- Run each 50 ticks
- Export, share, replay
- Fork a scenario
- Try to break moderation (adversarial inputs)
- Try edge cases (empty description, huge scenario, etc.)

### Checklist approval
- Engineering sign-off
- Design sign-off (rendering looks right)
- Product sign-off (journey feels right)

**No release ships with an open critical issue.**

---

## Specific Hard-to-Test Cases

### "Does emergence happen?"

Can't directly test. Proxy metrics:
- Action diversity (characters don't all converge on same actions)
- Relationship entropy (relationships differentiate over time)
- Conversation depth (dialogue threads extend >3 turns)
- Role differentiation (inferred roles emerge without being pre-configured)

Track over time. Regression = something wrong.

### "Are characters consistent?"

Run 1000 ticks of a world. Periodically, LLM judge compares:
- Agent's current behavior vs their persona
- Agent's current action vs their past actions
- Agent's stated goals vs their actions

Consistency score > 0.7 = good.

### "Does god intervention feel natural?"

Hard to test automatically. Human review during gauntlet:
- Does intervention produce in-world reactions?
- Do characters acknowledge the event?
- Does the world's narrative adapt or ignore?

### "Is the rule compiler correct?"

For each compiled rule, test:
- Do obvious violations trigger it?
- Do obvious compliances pass?
- Is it in the correct tier?

Maintain a growing "rule compiler test set" of canonical inputs → expected outputs.

---

## Performance Testing

### Throughput
- Target: 20 agents × 100 ticks in <5 minutes (real time) on a laptop
- With Haiku default

### Latency
- Tick duration < 10s with 10 agents
- Dashboard WebSocket deltas arrive <500ms after event

### Cost
- Default 10-agent × 100-tick run costs <$1
- Alert if cost per tick trending up

### Memory
- Engine process stays under 2GB RAM for 50-agent world
- SQLite file size < 10MB per chronicle typical

---

## Regression Testing

Every merged PR:
- Full unit + integration suite
- 3 canonical scenarios (fast)
- No failed tests

Weekly:
- Full drama benchmark
- All 50 curated scenarios
- Compare to previous week

Monthly:
- Human audit
- Cost audit
- Performance profiling

---

## Chaos Testing

For peace of mind at scale:
- Kill engine mid-tick → recovery works
- Corrupt random DB rows → recovery works
- Inject provider errors randomly → graceful degradation
- Network disconnect → WebSocket reconnects

Run chaos suite quarterly.

---

## Documentation as Test

Every design doc has claims like "characters persist across ticks" or "rules can be added mid-run." Each claim should have a corresponding test.

When updating docs, update tests. When updating tests, update docs.

---

## The Cultural Rule

**No test coverage = not done.**

Design docs without scenario tests are speculative.
Code without integration tests is fiction.
Features without E2E coverage are demos, not product.

Our bar: **if it's in our marketing, it has an automated test.**
