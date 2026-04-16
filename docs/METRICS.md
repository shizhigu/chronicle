# Metrics — The Health Dashboard

## Why These Metrics

A PM without a metric dashboard is flying blind. Chronicle's business is "people create and share AI simulations." The metrics directly measure whether that's happening.

We avoid vanity metrics (total signups). We focus on what predicts survival.

---

## North Star Metric

**Weekly Creators × Shares per Creator**

Translation: how many humans this week ran a chronicle that produced a shareable artifact.

This captures both depth (did they actually use it?) and virality (did it spread?).

Target curve:
- Month 1: 1K weekly creators × 0.5 shares avg = 500 shared chronicles
- Month 6: 50K × 1.2 = 60K shared chronicles
- Year 2: 500K × 2 = 1M shared chronicles

---

## Input Metrics (Leading Indicators)

### Activation funnel

| Step | Target rate | Measured as |
|---|---|---|
| Install start → install complete | >90% | CLI post-install ping |
| Install → first chronicle created | >80% | world_created event |
| Created → tick 1 rendered | >85% | first tick_end |
| Tick 1 → tick 10 | >75% | reaches 10 ticks |
| Tick 10 → run finished | >60% | end_of_run event |
| Finished → share action | >40% | share/export/fork event |
| Finished → second chronicle | >35% | second world_created |

If any step drops > 10 pp in a week, something's broken.

### Engagement depth

- Avg chronicles per active creator per week: >3
- Avg ticks per run: 50+ (we try to make default 50)
- Avg runs per chronicle (including forks & replays): >1.5

### Viral coefficients

- Share → click-through: % of shared links clicked. Target >20%
- Click-through → install: % who install after clicking. Target >8%
- Install → share: % who eventually share. Target >40%
- Composite K-factor: 0.2 × 0.08 × 40 / 100 = 0.0064 shares-to-new-install per share. (Multiply by installs-to-shares = 0.4; back-of-envelope growth math.)

**Below 1.0 means we need other growth channels.**

### Conversion

- Free → paid: target 2% in month 1, 8% by month 6
- Paid retention (month-over-month): >88%
- ARPU (mixed, all paid tiers): $17

---

## Quality Metrics

### Drama quality (weekly benchmark)

From drama benchmark (see TESTING.md):
- Median drama score across benchmark scenarios: >6.0/10
- Character arcs present in >80% of runs
- Narrative shape (tension arc) in >70% of runs

**If this regresses between releases, DON'T SHIP.**

### Content consistency

- Agent persona drift score: <0.25 (stays in character)
- Dialogue quality score: >7.0/10 (LLM judge)
- Unexpected behavior rate: <5% (characters doing things no one asked for)

### Failure rates

- % runs that hit an unrecoverable error: <1%
- % runs that exceed budget: <5%
- % actions rejected by rule enforcer: 5-15% (healthy range; <5% means rules too permissive, >15% means too strict)
- % tool calls returning errors: <3%

---

## Product Metrics

### Feature adoption (within first 30 days of a user)

- Used god intervention: >50%
- Used fork: >30%
- Used share/export: >50%
- Used private worlds (Plus): >70% of Plus users
- Used custom sprites (Pro): >60% of Pro users

Low adoption = feature not surfaced well, or not valuable. Investigate.

### Gallery health

- % of gallery chronicles with >10 views: >40%
- % with >1 fork: >15%
- Median fork depth: >2
- "Featured" click-through: >25%
- Staff-featured vs user-voted split: 20/80

### Community

- Discord weekly active: >30% of paid subscribers
- Community Chronicle submissions per week: >100 after month 3
- Creator templates published per week: >20 after month 6

---

## Monetization Metrics

### Revenue

- MRR (monthly recurring revenue)
- ARR (annual run rate)
- Net dollar retention: >100% is healthy SaaS

### Unit economics

- LTV (lifetime value) per paid user: >$120 (12 months × average $10 net)
- CAC (cost of acquisition): <$40
- LTV/CAC: >3
- Payback period: <6 months

### Tier breakdown

- % on Plus vs Pro vs Cloud vs Lab
- Average upgrade from Plus → Pro: track velocity
- Enterprise pipeline: # qualified leads, ACV

---

## Ops Metrics

### Uptime

- Dashboard uptime: >99.5%
- Engine tick completion: >99.9%
- API response p95: <500ms
- WebSocket delivery: <200ms

### Safety / moderation

- Content flagged per 1K runs: <5
- Moderation SLA compliance: 95% within target time
- User-reported issues: <1 per 100 active users per week

### Cost

- Our cost per run (infra): $0.02-0.05
- Our cost per paid user per month: <15% of their ARPU
- Gross margin: >70% aggregate

---

## User Satisfaction

- NPS (quarterly survey): >40
- CSAT (after first run): >4.2/5
- Support tickets per 100 active users: <2
- Support response time: <24h for free, <4h for paid

---

## The Daily Standup

Every morning, PM looks at:

```
YESTERDAY
  Weekly creators: ▲ 12,483 (+3.2%)
  Shares per creator: 1.14 (target 1.5)
  Activation funnel: green all stages
  Drama benchmark: last run 6.4 (target 6.0+) ✓
  Uptime: 99.8% ✓

RED FLAGS
  ⚠ Tier 2 activation (install → world) dropped from 82% → 78%
  ⚠ Discord mods reported 3 problematic chronicles (now removed)

THIS WEEK
  [PM] Investigate activation drop. Possibly related to new install script.
  [ENG] Ship rule compiler v2 (already in staging, pending final test)
  [ART] 4 new sprite packs in review
```

---

## The Weekly Review (Fridays)

### What moved?
- Top 5 metrics with biggest change WoW
- Any traffic-light going yellow or red

### What did we ship?
- Release notes
- Which metric was it aiming to move?

### Did it move?
- Causal check: did the shipped change improve the target metric?
- If no: why? Bad hypothesis, bad execution, external factor?

### What's next?
- Top 3 priorities for next week
- Each priority mapped to a metric

---

## The Monthly Review (Board / Investor)

- Revenue growth MoM
- Total paid users
- Churn rate
- CAC / LTV
- One qualitative highlight (a viral chronicle, a user quote, a press mention)
- One challenge + plan

---

## Red Line Triggers (Pagerduty-style)

These are "drop everything and fix":

1. **Any auth/security/privacy breach** — not metrics-monitored, incident-monitored
2. **Safety: CSAM detected and not caught by moderation** — immediate incident
3. **Uptime < 95% in a week** — SRE war room
4. **Drama benchmark regression > 20%** — engine lead on it
5. **Activation funnel drop > 15 pp** — PM + growth on it
6. **Negative NDR for two consecutive months** — leadership review
7. **Viral K-factor cliff drop** — marketing + growth review

---

## The Dashboard (Actual UI)

We build an internal dashboard at `ops.chronicle.sh` showing all of these. Powered by:
- Event analytics (Posthog / Amplitude)
- Metrics DB (Postgres aggregation)
- External data (Stripe for revenue)
- Support tool (Intercom / Plain)

Nobody should have to run a query to see a key metric.

---

## Anti-Metrics (What We Don't Chase)

- **Total signups / registrations** — vanity, includes drop-offs
- **Page views / session time** — not tied to creation
- **Follower counts on socials** — optics, not impact
- **GitHub stars** — nice but not revenue

We measure things that predict survival.

---

## The Metrics Culture

- Every feature PR includes: *"This aims to move [metric] by [amount]."*
- Experiments require pre-registered hypothesis
- If we can't measure it, we don't claim it worked
- We hold honest postmortems when a metric moves wrong

**Chronicle ships to metrics. Metrics serve users. Users tell us the truth.**
