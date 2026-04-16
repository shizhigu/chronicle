<p align="center">
  <img src="./assets/banner.svg" alt="Chronicle" width="100%"/>
</p>

<h1 align="center">Chronicle &#x2696;&#xFE0F;</h1>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-2f7f2f?style=for-the-badge" alt="License: MIT"/></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-bun-fbf0df?style=for-the-badge&logo=bun&logoColor=black" alt="Bun"/></a>
  <a href="#"><img src="https://img.shields.io/badge/typescript-strict-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript strict"/></a>
  <a href="#"><img src="https://img.shields.io/badge/tests-689%20passing-4c1?style=for-the-badge" alt="689 tests passing"/></a>
  <a href="./docs/adr/"><img src="https://img.shields.io/badge/ADRs-14-D4AF37?style=for-the-badge" alt="14 ADRs"/></a>
  <a href="#"><img src="https://img.shields.io/badge/version-0.1.0--alpha-lightgrey?style=for-the-badge" alt="Version 0.1.0-alpha"/></a>
</p>

**A multi-agent simulation framework where AI-driven characters act inside typed rule systems and live governance structures.** Describe a scenario in natural language — a 1920s Paris salon, a doomed cruise ship, a founding parliament — and watch the characters vote, scheme, defect, and form coalitions. Not a game engine. Not a chatbot demo. A substrate for emergent political drama.

Run it from the terminal, steer it from [Claude Code](https://claude.com/claude-code) using natural language. Every tick is event-sourced; every run replays byte-identically from its seed.

---

| Feature | What it does |
|---|---|
| **Described in prose** | `chronicle create-world --desc "three elders compete to succeed a dying king"` — an LLM compiler turns free-form language into typed agents, rules, groups, and locations. No YAML, no JSON. |
| **Governed by typed rules** | Three tiers: **hard** (engine-enforced), **soft** (norms with social consequences), **economic** (action costs). Rules can be added, repealed, or scoped to a group mid-run. |
| **Live governance** | Characters form groups, vote on proposals, hold roles with authority, and override rules through legitimate procedure. 14 typed `Effect` kinds cover the full governance lifecycle — parliament, tyranny, anarchy, all composable. |
| **File-backed memory** | Per-character §-delimited memory in `~/.chronicle/worlds/<wid>/characters/<aid>/memory.md`. No embeddings, no RAG — the agent curates its own transcript with atomic writes, mutexes, threat scanning. |
| **CC-native live edit** | `chronicle edit-character Alice --mood paranoid`, `chronicle add-rule --tier hard --check "action.target != 'self'"`, `chronicle apply-effect --json '{...}'`. Every structural change lands on the next tick. |
| **Event-sourced replay** | SQLite event log per world. Fork at any tick (`chronicle fork --at-tick 42 --desc "what if the vote had failed"`). Share a run as a portable `.chronicle` archive. |

---

## Quick start

Requires [Bun](https://bun.sh) &ge; 1.1.

```bash
git clone https://github.com/shizhigu/chronicle
cd chronicle
bun install
bun run build
bun x chronicle
```

`bun x chronicle` walks you through creating your first world interactively. To go straight to a scenario:

```bash
bun x chronicle create-world --desc "8 survivors on a raft, 3 days of water, one map to land"
bun x chronicle run <worldId> --ticks 30 --live
bun x chronicle dashboard <worldId>    # browser view, streams events live
```

### Wire it to Claude Code (recommended)

Chronicle ships a Claude Code skill so CC recognises phrases like "make Carol paranoid", "add a harbor east of town", or "dissolve the council" and routes them to the right CLI call automatically.

```bash
mkdir -p ~/.claude/skills/chronicle
ln -sf "$(pwd)/.claude/skills/chronicle/SKILL.md" ~/.claude/skills/chronicle/SKILL.md
```

Now you sit in CC, describe world changes in natural language, and the simulation edits itself between ticks.

---

## How it's built

- **Stack**: Bun + TypeScript (strict), six workspace packages: `core`, `engine`, `runtime`, `compiler`, `cli`, `dashboard`. SQLite via `bun:sqlite` + drizzle-orm.
- **Agents**: each character is a [pi-agent](https://github.com/badlogic/pi-mono) session with file-backed memory. Per-tick activation gated by a deterministic 5-signal pre-filter ([ADR-0010](./docs/adr/0010-agent-activation.md)) — no LLM call unless something changed.
- **Rules & authority**: `EffectRegistry` (14 typed Effect kinds) + `RuleEnforcer` with 3-path authority resolution — agent, role, group ([ADR-0009](./docs/adr/0009-governance-primitives.md)).
- **Governance**: proposals run through `ProposalService` with vote / consensus / decree / lottery / delegated procedures. Same `Effect` types are shared between proposals and god interventions.
- **Resilience**: typed error classifier + jittered exponential backoff ([ADR-0013](./docs/adr/0013-resilience.md)), multi-key credential pool with cooldowns and round-robin / random / LRU strategies ([ADR-0014](./docs/adr/0014-credential-pool.md)).
- **Transport safety**: outbound-only redaction across 28 provider key patterns ([ADR-0012](./docs/adr/0012-transport-redaction.md)). Never applied at storage — the engine keeps real data.
- **Provider-agnostic**: Anthropic / OpenAI / LM Studio / any pi-agent-supported endpoint. Config-switchable, no code changes, no lock-in.

Architecture essay: [`DESIGN.md`](./DESIGN.md). Full ADR index: [`docs/adr/`](./docs/adr/).

---

## Documentation

| Doc | Purpose |
|---|---|
| [DESIGN.md](./DESIGN.md) | Master design document |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System architecture overview |
| [docs/AGENT_RUNTIME.md](./docs/AGENT_RUNTIME.md) | How characters are implemented |
| [docs/CLI.md](./docs/CLI.md) | Full CLI reference |
| [docs/RULE_COMPILER.md](./docs/RULE_COMPILER.md) | Natural-language &rarr; typed rules |
| [docs/USER_JOURNEY.md](./docs/USER_JOURNEY.md) | First-60-seconds experience |
| [docs/adr/](./docs/adr/) | 14 architectural decision records |
| [docs/FAQ.md](./docs/FAQ.md) | Frequently asked questions |

---

## Status

**v0.1.0-alpha** &mdash; 689 tests passing across 66 files, 14 ADRs committed. Governance, activation, resilience, and credential-pool layers (L2) are shipped. CLI exposes ~20 commands including the CC escape hatch (`apply-effect`) and ergonomic wrappers for every governance lifecycle operation. Dashboard streams redacted live event feeds over websocket.

Next on the roadmap: multi-world forking, cross-world imports, shareable `.chronicle` archives, and the first showcase scenarios.

---

## License

[MIT](./LICENSE). Fork freely. Share generously.

---

<p align="center">
  Built with <a href="https://github.com/badlogic/pi-mono">pi-agent</a> &middot; Designed for <a href="https://claude.com/claude-code">Claude Code</a>
</p>
