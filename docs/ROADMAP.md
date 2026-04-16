# Roadmap

## The Principle

Not a MVP mentality. Each milestone is a fully usable product for a specific use case. We ship the whole stack at each stage, just the scope of what's supported grows.

Dates are aggressive but realistic assuming full focus.

---

## v0.1 "Chronicle" (Private Alpha — 2026-05-15)

**Scope**: CLI-only, text-first, one genre.

### What ships
- CLI tool (`chronicle` binary, npm install)
- SQLite schema + migrations
- pi-agent runtime for characters
- Three-tier rule compiler (all tiers functional)
- One example scenario: **Dinner Party of Secrets**
- Text-based live event streaming (no dashboard yet)
- Export to `.chronicle` file (config + events)
- Basic replay from `.chronicle` file

### What doesn't ship
- Web dashboard
- Rendering surfaces (map, gazette, whisper stream, highlight reel)
- Cloud hosting
- Public gallery
- Accounts / payments

### Who uses this
- Internal testing
- 10 hand-picked alpha users (researchers, technical creators)

### Success criteria
- 10 alpha users each run ≥3 chronicles successfully
- 5+ of them say "I want to keep using this"
- Drama benchmark score >5.0 on dinner party

---

## v0.2 "Visual Chronicle" (Public Beta — 2026-07-01)

**Scope**: Web dashboard, live map, share links.

### What adds
- Next.js web dashboard
- Live 2D map with character sprites
- Speech bubble rendering
- Timeline scrubbing
- Agent inspector
- God intervention UI (text box + submit)
- 5 example scenarios (dinner party, desert island, startup, high school, kingdom court)
- Basic replay links (shareable URLs)
- Installer one-liner (`curl | bash`)
- CLAUDE.md hint auto-install

### What doesn't ship
- Gazette / whisper / highlight reel (still v0.3)
- Cloud hosting
- Public gallery
- Accounts (still local-only)
- Payments

### Who uses this
- Open beta: ~5K self-selected users
- Promoted to HN, Twitter AI community

### Success criteria
- >1K installs in first 30 days
- >50 Chronicles shared publicly (via replay links)
- 1+ viral moment (Twitter thread >10K views)
- Drama benchmark score >6.0

---

## v0.3 "Shareable Chronicle" (2026-09-01)

**Scope**: The four rendering surfaces + sharing ecosystem.

### What adds
- Gazette generator (LLM-produced + HTML templated)
- Whisper stream UI (per-character mobile-friendly view)
- Highlight reel video export (30-60s mp4)
- Fork mechanic (with attribution chain)
- Hosted sharing (anonymous replay links via chronicle.sh/r/)
- Basic account system (email + password, optional)
- CSV/JSON export for data-curious users

### What doesn't ship
- Payments / paid tiers
- Public gallery (still "link-only sharing")
- Custom sprites (still default set)

### Who uses this
- 50K+ users target
- Content creator push (partner with 10 AI YouTubers)

### Success criteria
- >25% of runs produce a share artifact
- >15% of gallery visitors fork something
- 10+ chronicles hit 10K views each

---

## v1.0 "Public Chronicle" (2026-12-01)

**Scope**: Gallery, accounts, payments. Fully a consumer product.

### What adds
- Public gallery with TikTok-style scroll
- Full account system
- Stripe integration + payment tiers (Plus $12, Pro $29)
- Chronicle Cloud (hosted inference, BYO optional)
- Content moderation full stack (Layer 1-4 from GOVERNANCE)
- Rating system (E/T/M/AO)
- Report + moderation backend
- Discord bot (alpha)
- Trust Report automated generation

### Who uses this
- 250K+ users
- First paid users
- Press coverage (we pitch TechCrunch, The Verge)

### Success criteria
- $50K+ MRR
- >2% free → paid conversion
- Top 10 on HN launch day
- Week 1: >100K page views on chronicle.sh
- Gallery has >5K public chronicles

---

## v1.5 "Platform Chronicle" (2027-03-01)

**Scope**: Extensibility + research features.

### What adds
- Custom sprite upload (Pro users)
- Custom gazette templates
- Chronicle Lab tier ($500/yr academic)
- API access for developers
- Webhook integrations (Slack, Discord, Zapier)
- Rule proposal mechanic (agents vote on new rules)
- Multi-world dashboards (Pro feature)
- Advanced analytics per Chronicle
- i18n: Spanish, Chinese, Japanese UIs

### Success criteria
- $250K MRR
- 5+ peer-reviewed papers cite Chronicle
- First 3 enterprise contracts signed

---

## v2.0 "Chronicle Network" (2027-09-01)

**Scope**: Platform effects. Chronicle becomes infrastructure.

### What adds
- Chronicle Exchange (sprite packs, rule packs, scenario templates; creators monetize)
- Embed widget for third-party sites
- Mobile app (iOS + Android, view-only + creation)
- Streaming integration (Twitch extension: watch a Chronicle run live on stream)
- Chronicle Enterprise (self-hosted, custom compilation)
- Multi-user god mode (several people direct together)

### Success criteria
- $1M+ ARR
- >10% of new users come from referrals/shares
- Creator economy: >$10K/month paid to template authors

---

## v3.0 and Beyond (2028+)

Speculative but directionally:
- **Voice** — characters actually speak (TTS), listen (STT)
- **Video** — characters rendered as talking heads or real-looking scenes (when models are there)
- **Real-world integration** — Chronicle generates events that actual services act on (Slack bot posts, emails sent, etc.)
- **Multi-Chronicle universes** — worlds that share state (characters moving between)
- **Educational vertical** — Chronicle Jr. for schools

---

## Cross-cutting: What's Always On

No matter which version, these run continuously:

### Safety + moderation
- From v1.0 onward, full moderation stack operates 24/7
- Pre-v1 (limited users), simpler guardrails

### Drama quality
- Weekly benchmark run from v0.1
- Must not regress between versions

### Cost monitoring
- Per-run cost tracking from v0.1
- Budget controls from v0.2

### Documentation
- Docs updated in same PR as code
- Video tutorials from v0.2

---

## What We Explicitly Delay

- **3D rendering**: not before v3. Adds cost, reduces accessibility.
- **Custom LLM fine-tuning**: not needed; our rules/prompts are the wedge
- **Game engine integration (Unity, Unreal)**: enterprise only, not before v2
- **Native mobile apps**: v2. Web is enough for v1.
- **Voice/video**: v3+
- **Real-money creator economy**: v2. Need trust + scale first.

---

## What Would Make Us Accelerate

- Viral moment at v0.2 (we rush v0.3)
- Big partnership offer pre-v1 (adjust to partner needs)
- Competitor shipping similar (defensive sprint on differentiators)

---

## What Would Make Us Pivot

- Emergence consistently boring → rethink whether this is even a product
- LLM costs triple → need aggressive efficiency work
- Legal/moderation crisis → Governance v2 sprint
- No viral moment in first 6 months → growth strategy revamp

---

## The Timeline Truth

Shipped on-time product = 60% what we planned + 40% what we learned.

Every date above is intent, not commitment. We ship when quality bar met. We'd rather delay v0.2 two weeks than ship a broken dashboard.

But we also won't ship nothing for a year. A shipped rough thing beats a perfect unshipped thing.

---

## Team Needs per Phase

See TEAM.md (not yet written). Summary:

- **v0.1**: solo founder / 2-person
- **v0.2**: add frontend eng, designer
- **v0.3**: add growth / content
- **v1.0**: add CS/moderation, full-time DevOps
- **v1.5**: research lead (academic partnerships)
- **v2.0**: sales (enterprise), mobile eng

Fundraising timed around v1.0 (or earlier if opportunity).

---

## The Anchor

Everything above anchored to **North Star metric: weekly creators × shares per creator**.

If we're growing that, roadmap is on track.
If we're not, we stop and ask why before shipping more.
