# Cost Model — The Economics of Running Chronicle

## Why This Matters

Every design decision eventually touches cost. If a chronicle costs $50 to run, only researchers use us. If it costs $0.30, anyone tries.

We target: **a meaningful first-run under $0.50 on default settings.**

Everything below serves that target.

---

## Per-Call Cost Benchmarks (Apr 2026 pricing)

Reference input/output costs per 1M tokens for common models:

| Model | Input $/1M | Output $/1M | Typical per-call |
|---|---|---|---|
| Claude Haiku 4.5 | $0.25 | $1.25 | $0.0008 |
| Claude Sonnet 4.6 | $3 | $15 | $0.015 |
| Claude Opus 4.6 | $15 | $75 | $0.08 |
| GPT-5-mini | $0.30 | $1.50 | $0.0010 |
| GPT-5 | $2.50 | $10 | $0.013 |
| Gemini 2.5 Flash | $0.10 | $0.40 | $0.0005 |
| Ollama (local) | free | free | free (just electricity) |

"Typical per-call" assumes ~1500 input tokens (system + context + observation) and ~150 output tokens (action decision).

---

## The Cost Stack for a Single Chronicle

Take a concrete scenario: **10 agents × 100 ticks, Haiku default**.

### Base decisions

- 10 agents × 100 ticks = 1000 agent-decision LLM calls
- Each call ~1500 in / 150 out = $0.0008 per call
- Subtotal: **$0.80**

### Reflections

- Every 20 ticks, every live agent reflects using Sonnet
- 10 agents × 5 reflections = 50 Sonnet calls
- Each ~3000 in / 500 out = $0.0165 per call
- Subtotal: **$0.83**

### Rule compilation (one-time at world creation)

- One Sonnet call ~2000 in / 2000 out = $0.036
- Subtotal: **$0.04**

### Memory embeddings

Not used. Character memory is file-backed (markdown per character),
curated by the agent via `memory_add` / `memory_replace` / `memory_remove`
and injected into the system prompt as a frozen snapshot per session.
No embedding calls, no vector DB — $0.00.

### God interventions (if user intervenes 3×)

- Each parsed with Sonnet
- 3 calls × $0.01 = **$0.03**

### Soft-rule judge (if enabled)

- ~30% of actions trigger a judge call
- 300 calls × Haiku at lower tokens = 300 × $0.0003 = **$0.09**

### Gazette (if generated)

- 5 "days" × one Sonnet call for newspaper = 5 × $0.02 = **$0.10**

### Highlight reel (if generated)

- One Sonnet call for scoring/selection
- Video encoding cost (compute only): ~$0.002
- Subtotal: **$0.03**

---

### Total for a "typical generous run"
**~$1.93** for 10 agents × 100 ticks + reflections + all export artifacts.

For a minimal run (just actions, no gazette/reel):
**~$0.80** for core only.

---

## Scaling Curves

### Ticks (linear)

| Ticks | 10-agent cost |
|---|---|
| 50 | $0.45 |
| 100 | $0.83 |
| 500 | $4.10 |
| 1000 | $8.20 |
| 5000 | $41 |

### Agents (linear)

| Agents | 100-tick cost |
|---|---|
| 3 | $0.28 |
| 10 | $0.83 |
| 20 | $1.63 |
| 50 | $4.05 |
| 100 | $8.10 |

### Model tier multiplier

Switch default from Haiku → Sonnet:
- Routine calls cost ~18x more
- 10-agent × 100-tick base goes from $0.80 → $15
- Run a character on Sonnet while others stay Haiku: proportional cost bump

---

## Optimizations We Use (Each Quantified)

### 1. Prompt caching (Anthropic)
- System prompt + persona cached between ticks
- ~75% of static token input
- **Saves 40-50% on input cost**

### 2. Observation caching
- If agent's observation hasn't changed (same location, no nearby changes) → skip LLM, auto-action=wait
- Empirically: ~25-30% of idle agents in typical runs
- **Saves 20% overall**

### 3. Model tiering
- Haiku routine, Sonnet reflection only
- Already baked into our default numbers above

### 4. Batched scenes (future optimization)
- When 10+ agents in same room, batch their observations into one prompt
- LLM returns action-per-agent in single call
- **Saves 30-50%** in crowd scenes (not applicable to sparse worlds)

### 5. Local Ollama for routine
- User configures Ollama for Haiku-tier decisions
- Reflection still uses API (quality needed)
- **Saves ~95% if user has decent GPU**

---

## The Budget Controls

Every world has tier-appropriate budget controls:

| Control | Default | Behavior |
|---|---|---|
| `godBudgetTokens` | none (unlimited) | Hard cap on total world spend |
| Per-tick alert | warning at $0.50 | "You've spent $0.50 so far" |
| Per-run soft cap | $1 for free tier | Pause + prompt user |
| Per-agent personal budget | none | Agent-level constraint (game mechanic) |

User sees real-time cost counter in dashboard top-right:
```
🟢 $0.34 / $2.00 budget
```

Color codes: green < 60%, yellow 60-85%, red > 85%.

---

## Pricing Tier Breakeven Analysis

### Free Tier (BYO API key)

- User pays LLM provider directly
- Our cost: hosting (gallery replays, sprite assets) + moderation API
- Per active user per month: ~$0.30 in our infra
- We need paid conversion rate >1% to break even across free users

### Chronicle Plus — $12/month

- Unlimited runs, but still BYO API key for inference
- Value-add: private worlds, video export, full sprites, all gazette themes
- Our cost: hosting + some video rendering compute
- Per-user cost: ~$2/month (video rendering is the big one)
- Margin: ~83%

### Chronicle Pro — $29/month

- BYO API key
- Full features: custom sprites, multi-world dashboards, analytics
- Our cost: ~$5/month (custom rendering pipeline + analytics)
- Margin: ~83%

### Chronicle Cloud — Usage-based

- We proxy LLM calls
- Markup: 20% over raw LLM cost
- $0.05 = ~1 Haiku-tier tick of a 10-agent world
- User buys credits; we take the margin

**Credit pricing**:
- 100 credits = $5 (one cup of coffee)
- 500 credits = $20
- 2000 credits = $60

Our blended cost per credit: ~$0.04. Markup: 25%.

### Chronicle Lab — $500/year

- Unlimited usage (BYOK)
- Our cost: ~$50/year in infra + support + priority feature work
- Margin: ~90%
- Strategic: citability, research partnerships, defensibility

### Chronicle Enterprise — $30K+/year

- Self-hosted option (we ship Docker + Helm)
- Custom rule compilers, domain packs, SSO, SLA
- Our cost: ~$5-10K/year per account (implementation + support)
- Margin: 75-85%

---

## Sensitivity Analysis

**What if Haiku triples in price?**
- Default Haiku run: $0.80 → $2.40
- Plus tier economics unchanged (still BYOK)
- Cloud margin compresses; we raise credit prices 20-30%

**What if all models halve in price (likely direction)?**
- Default run: $0.80 → $0.40
- Free tier becomes even more attractive
- Competitive threat: someone could offer Cloud at lower markup
- Our response: compete on features (gallery, export quality) not price

**What if emergence requires 5x more reflection calls?**
- Current reflection = 20% of cost; at 5x becomes equal to action cost
- Total per-run: $0.80 → ~$1.60
- Still within target for default free-tier run
- Acceptable

---

## Cost-Sensitive Design Choices

A few choices we made explicitly to keep costs down:

### ✅ Default to Haiku for actions
Saves ~80% vs Sonnet. Quality is fine for most character decisions.

### ✅ Reflections every 20 ticks (not every tick)
Sonnet reflection is ~$0.015 per call. Too frequent explodes cost.

### ✅ Soft-rule judge uses Haiku
Per-action cost $0.0003. Tolerable even at 30% trigger rate.

### ✅ Gazette only on demand (not every day)
Users don't always want it. Make it a tool, not automatic.

### ✅ Highlight reel only when requested
Video generation is compute-expensive locally. On-demand saves infra.

### ❌ We DON'T batch scenes in v1
Cheaper but harder to implement correctly. Ship sparse-world version first.

### ❌ We DON'T use embeddings or vector retrieval at all
Memory is a plain markdown file per character, curated by the agent
itself (hermes-agent pattern). The file is injected into the system
prompt at session start as a frozen snapshot — prefix cache friendly,
inspectable by users, zero embedding spend.

---

## Break-even Scenarios

For Chronicle to be a viable business:

### Optimistic (our plan)
- Month 12: 250K free users, 10K paid
- Avg ARPU: $14 (mix of Plus/Pro/Cloud)
- Monthly revenue: $140K = $1.68M ARR
- Hosting costs: ~$60K/month
- Gross margin: ~58%
- Breakeven at ~$1M ARR

### Pessimistic (still viable)
- Month 12: 100K free, 2K paid
- Avg ARPU: $12
- Monthly revenue: $24K = $288K ARR
- Hosting costs: ~$20K/month
- Gross margin: ~17% (thin)
- Need to reduce infra costs or increase pricing

### Failure mode
- Most users bounce; paid conversion <0.5%
- Free tier costs exceed what enterprise covers
- We shut down or pivot to research-only

---

## Long-term Cost Trajectory

LLM costs are falling ~50% per year. We expect:

- **Year 1**: default run $0.50-1
- **Year 3**: default run $0.10-0.20
- **Year 5**: default run near-free (LLM inference commoditized)

By year 5, cost is not a constraint. Everyone can run unlimited Chronicles.

At that point, monetization shifts to:
- Premium features (better rendering, advanced analytics)
- Creator economy (revenue share on popular templates, sprite packs)
- Enterprise licensing
- Data licensing (academic access to anonymized chronicles)

---

## What We Don't Charge For (Ever)

- Running a chronicle with your own API key
- Watching another user's public chronicle
- Basic fork functionality
- Gallery browsing
- Exports of YOUR OWN chronicles

**Free should be genuinely useful forever.** Paid tier adds power, privacy, polish.

---

## The Honest Picture

- Our core cost per run is real but small ($0.30-$2 typical)
- Provider pricing may shift, we stay multi-provider
- Free tier is a loss leader (cheap enough to afford)
- Paid tiers have high margins because most infra is shared
- Long-term trend is cheaper inference → better product for everyone

No hidden cost bombs. No "usage-based with surprise bills" games. We show the meter.
