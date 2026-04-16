# Chronicle

> Describe any world. Watch AI agents play it out.

Chronicle is a configurable social simulation substrate. You write a one-sentence
description of a world — any world — and the system compiles it into a running
simulation with AI-driven characters, persistent memory, emergent drama, and
live animated rendering.

**Not a pre-built scenario. A framework.** Dinner party, desert island, medieval
court, startup founders, high school — anything you can describe.

---

## Quick Start

```bash
curl -sSL https://chronicle.sh/install | bash
chronicle
```

You'll be guided through creating your first world. Takes 30 seconds.

If you have [Claude Code](https://claude.com/claude-code) installed, it will
walk you through the whole thing conversationally.

---

## Core Ideas

### 1. Natural Language All the Way Down

You never write YAML. Never write JSON. Never write code.

```
$ chronicle create-world --desc "8 people at a dinner party, each has a secret"
```

The compiler does the rest.

### 2. Same Context = Same Character

Every character is a persistent pi-agent instance. Their memory, persona, and
conversation history carry across ticks. They *are* who they are across the
entire run.

### 3. Rules Emerge, Or Are Declared

Rules compile to three tiers:
- **Hard**: engine-enforced, physical laws
- **Soft**: norms characters can violate, with social consequences
- **Economic**: action costs and conversions

Characters can propose new rules mid-run. Institutions emerge.

### 4. God Mode Always Available

Inject events: *"A storm hits the island."*
Modify characters: *"Make Elena suddenly vengeful."*
Change rules: *"From now on, lying is a capital offense."*

You direct. They improvise.

### 5. Every Run is Shareable

Every chronicle auto-generates:
- 🗞 Gazette (newspaper-style summary)
- 🎥 Highlight reel (auto-cut 30-60s video)
- 💬 Whisper stream (character POV feed)
- 🔗 Replay link (anyone can watch)
- 📁 `.chronicle` file (forkable by others)

Content is ready-made for Twitter, TikTok, Reddit, Discord.

---

## Documentation

- `DESIGN.md` — master design document
- `docs/AGENT_RUNTIME.md` — how characters are implemented (pi-agent)
- `docs/RULE_COMPILER.md` — natural-language → enforceable rules
- `docs/CLI.md` — CLI reference
- `docs/RENDERING.md` — visualization system
- `docs/USER_JOURNEY.md` — first-60-seconds experience
- `docs/PRODUCT.md` — strategy, ICP, pricing
- `docs/GOVERNANCE.md` — safety, moderation, legal
- `docs/EXPORT_SHARE.md` — viral distribution mechanics
- `schema/SCHEMA.sql` — complete SQLite schema

---

## Status

**v0.1.0-alpha** — architectural design complete, implementation in progress.

This repo contains:
- Full design documentation
- Database schema (ready)
- Core type definitions (TypeScript)
- Engine skeleton (tick loop, rule enforcer)
- CLI skeleton (commands structured, implementations pending)
- First example (`examples/dinner-party`)

---

## Philosophy

> Humans have always created stories. With AI agents, we can now *direct*
> stories and watch them unfold with real emergent behavior. This is a new
> medium — not replacing fiction, but extending it.

Chronicle is the consumer product for this medium.

---

## License

MIT. Fork freely. Share generously.

---

*Built with [pi-agent](https://github.com/badlogic/pi-mono).*
