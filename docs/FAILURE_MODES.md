# Failure Modes — What Breaks, How We Catch It

## Philosophy

Everything breaks eventually. Good products degrade gracefully. Great products recover automatically.

For every failure below: **detection**, **user-facing behavior**, **recovery**, **post-mortem trigger**.

---

## Category 1 — LLM / Provider Issues

### 1.1 Provider API outage (timeout)

**Detection**: request times out or returns 5xx after 30s.

**User-facing**: tick pauses. Status bar: "⚠️ Connection issue — retrying...". Characters freeze with "..." overhead sprite.

**Recovery**:
- Retry with exponential backoff (5s, 10s, 30s, 60s)
- If 3 retries fail, pause world + show modal:
  - "Your model provider is unreachable. [Retry] [Switch provider] [Pause until resolved]"
- On "Switch provider": guide user to change world config
- On resolve: resume from last persisted tick

**Post-mortem trigger**: if >1% of runs hit outage in a week, investigate provider reliability.

### 1.2 Rate limiting (429)

**Detection**: HTTP 429 or provider-specific rate limit response.

**User-facing**: tick slows down. Status bar: "⏳ Hitting rate limits — slowing down"

**Recovery**:
- Exponential backoff
- If user has Cloud tier: switch to backup provider automatically
- If free tier: show upgrade CTA: "Upgrade to Chronicle Cloud to avoid rate limits"

**Post-mortem trigger**: if we're the reason user hit limits (batch sizes too aggressive), fix.

### 1.3 Provider returns invalid response

**Detection**: JSON parse failure, unexpected schema, or pi-agent schema validation fails.

**User-facing**: character's action this tick shows "[couldn't decide]". No user-visible error.

**Recovery**:
- Retry once with slightly different prompt (add "respond with a valid tool call")
- If still fails, agent acts as "wait"
- Log for analysis

**Post-mortem trigger**: if >5% of calls hit this, investigate prompt issue or provider change.

### 1.4 Model returns problematic content

**Detection**: content moderation classifier flags output.

**User-facing**: if severe: block action, character silent this tick. If mild: redact + proceed.

**Recovery**:
- Severe: log incident, agent action becomes "wait"
- Mild: redact offending substring, keep surrounding context
- If same character triggers 5× in 100 ticks: notify user "Marcus seems to be getting out of character — reset?"

**Post-mortem trigger**: every block logged for review. Patterns → update moderation rules.

### 1.5 Context window overflow

**Detection**: total tokens in message history > 80% of model's limit.

**User-facing**: no user-visible issue if compaction works. If it fails: "Character's memory is being compacted" notice.

**Recovery**:
- `transformContext` hook triggers → summarize oldest half → replace with summary
- If even summary exceeds limits: aggressive truncation + alert

**Post-mortem trigger**: track compaction frequency. If agents compact too often, tune memory retrieval.

---

## Category 2 — Engine State Issues

### 2.1 Budget exceeded mid-run

**Detection**: `world.tokensUsed >= world.godBudgetTokens`

**User-facing**: world pauses. Modal:
```
⚠️ Budget reached
You've spent $1.00 so far. 
[+ Add $1]  [+ Add $5]  [End run]
```

**Recovery**:
- If add: extend budget, resume
- If end: mark world `status=ended`, export available artifacts

**Post-mortem trigger**: if most runs hit budget, default is too low.

### 2.2 Agent action validation fails repeatedly

**Detection**: same agent has rejected actions 5 ticks in a row.

**User-facing**: agent inspector shows "Stuck — try intervening"

**Recovery**:
- After 3 rejections, inject a "hint" into agent's next prompt: "Your recent actions keep failing rules. Try something different."
- After 5 rejections, engine auto-action=wait for this agent
- God can nudge: `chronicle intervene <id> --event "<name> realizes they need a different approach"`

**Post-mortem trigger**: patterns across runs → rules might be too strict.

### 2.3 Race condition in parallel action resolution

**Detection**: two agents claim the same resource in same tick.

**User-facing**: one succeeds, other gets "[action couldn't complete — someone else got there first]"

**Recovery**:
- Deterministic resolution via sort order (birth_tick, rng)
- Loser's action rejected with clear reason

**Post-mortem trigger**: if this happens frequently, consider resource-locking mechanism.

### 2.4 Stuck tick (never completes)

**Detection**: tick hasn't ended within 5 minutes.

**User-facing**: "Tick taking unusually long — something may be stuck"

**Recovery**:
- Force abort current tick
- Mark pending actions as "wait"
- Resume from tick boundary

**Post-mortem trigger**: always. Something hung.

### 2.5 Database corruption / lost state

**Detection**: SQLite integrity check fails; or load returns malformed data.

**User-facing**: "Something went wrong loading your world. Attempting recovery..."

**Recovery**:
- Automatic: restore from last snapshot (every 10 ticks)
- If no snapshot: rebuild from event log (event-sourced)
- If event log corrupted: user alerted, can restore from export if they made one

**Post-mortem trigger**: always. This should never happen.

---

## Category 3 — User-Induced Issues

### 3.1 User describes impossible world

e.g. "Simulate the entire planet with 8 billion people."

**Detection**: compiler scale estimation > limits for tier.

**User-facing**: gentle pushback:
```
That's a LOT of agents. For your tier, I can support up to 50.
Want me to scale down to a representative group?
[Yes, pick 10 key characters]  [Upgrade for more]  [Cancel]
```

**Recovery**: user chooses.

### 3.2 User's scenario has no clear drama

e.g. "10 people enjoy a calm afternoon."

**Detection**: after creation, drama predictor warns.

**User-facing**: warning at creation:
```
✓ World created
💡 Note: your scenario is very peaceful. You might want to watch for 
drama spikes to be injected automatically (enabled by default), or 
add a tension source yourself.
```

**Recovery**: run with catalyst injection on.

### 3.3 User wants to simulate specific real people

e.g. "Elon Musk and Mark Zuckerberg debate."

**Detection**: compiler flags specific real-person matching.

**User-facing**:
- Public figures, satirical: proceed + add disclaimer overlay
- Private individuals: block + explain
- Historical: allowed

**Recovery**: disclaimer or block as appropriate.

### 3.4 User requests prohibited content

**Detection**: Layer 1 input moderation.

**User-facing**: block + explain. Link to community guidelines.

**Recovery**: user must revise.

### 3.5 User's budget runs out mid-payment-change

**Detection**: during payment processing, world continues, budget exhausts.

**User-facing**: world pauses; payment completes; prompt to resume.

**Recovery**: auto-resume after payment confirms.

---

## Category 4 — Infrastructure Issues

### 4.1 Dashboard WebSocket disconnects

**Detection**: heartbeat missed.

**User-facing**: "Connection lost, reconnecting..." overlay.

**Recovery**:
- Auto-reconnect with exponential backoff
- On reconnect, fetch state delta since last known tick
- Repaint only changed cells

**Post-mortem trigger**: frequent disconnects → server issue.

### 4.2 Sprite asset 404

**Detection**: asset load fails.

**User-facing**: fallback to default sprite (one of our 16 built-in). Small warning in dev console.

**Recovery**:
- Retry once
- Use fallback permanently
- Log for asset issue investigation

### 4.3 Video rendering fails (highlight reel)

**Detection**: ffmpeg or canvas exception.

**User-facing**: "Highlight reel generation failed. [Retry]" button.

**Recovery**:
- Auto-retry once with fallback settings (lower resolution)
- If still fails: show partial result (image carousel instead of video)
- Log for debugging

### 4.4 Storage full (local .db file)

**Detection**: SQLite write fails with SQLITE_FULL.

**User-facing**: "Not enough disk space to continue. [Free up space] [Export and delete oldest worlds]"

**Recovery**: user action required.

---

## Category 5 — Catastrophic Issues

### 5.1 Our servers go down (Cloud users)

**Detection**: health check fails.

**User-facing**: chronicle.sh shows status banner. API returns 503 with friendly message.

**Recovery**:
- Runbook: failover to backup region
- Communicate via status.chronicle.sh + Twitter
- Postmortem published publicly within 48h

**Post-mortem trigger**: always.

### 5.2 Model provider changes API in breaking way

**Detection**: integration tests fail after provider update.

**User-facing**: affected users see increased error rates until we fix.

**Recovery**:
- Rapid patch deploy
- If long outage: route affected users to alternate provider automatically
- Credit Cloud users for downtime

**Post-mortem trigger**: always. Update integration test coverage.

### 5.3 Legal cease-and-desist about user's chronicle

**Detection**: formal notice received.

**User-facing**: the specific chronicle is removed from gallery pending review.

**Recovery**:
- DMCA takedown: process within 10 days
- Defamation claim: legal review, likely removal
- User notified + appeal possible
- Trust Report updated

**Post-mortem trigger**: always. Policy review.

### 5.4 Mass policy violation in public gallery

**Detection**: trending scenario type gets flagged multiple times.

**User-facing**: affected scenarios removed; gallery-wide announcement if significant.

**Recovery**:
- Emergency moderation push
- Rule update to block similar future submissions
- Public statement if press coverage

---

## Recovery UX Principles

1. **Never lose work.** Every tick is an autosave. Crashes resume.
2. **Always explain.** No mystery errors. Human-readable reason + what to do.
3. **Default to safe.** Pause, don't crash. Ask user, don't guess.
4. **Preserve creative state.** Fork trees, shared links, exports — untouchable by recovery.
5. **Communicate outages.** Status page + proactive notification.

---

## Observability

For every failure category:
- Logged to our telemetry (anonymized event + timestamp + severity)
- Aggregated in weekly "failure review"
- Trending failures get priority in next sprint
- Public uptime stats at status.chronicle.sh

---

## Test Coverage

Each failure mode has a corresponding test in `packages/engine/test/failures.spec.ts`:

- `test("handles provider timeout with retry", async () => {...})`
- `test("budget exceeded pauses world", async () => {...})`
- `test("compaction keeps context under limit", async () => {...})`
- `test("database recovery from snapshot", async () => {...})`
- etc.

**Never ship without passing these.**

---

## The User Trust Equation

Every failure we handle gracefully = a point of trust earned.
Every failure we botch = 10 points lost.

We err on conservative: pause more, auto-correct less, explain always.
