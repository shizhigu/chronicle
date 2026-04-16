# Chronicle Design Docs — Index

## Start Here

- **[../DESIGN.md](../DESIGN.md)** — The master document. Read first. Vision + architecture + decisions.

---

## Build Order (if you're implementing)

1. **[../schema/SCHEMA.sql](../schema/SCHEMA.sql)** — Database schema. The data model is the foundation.
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** — How the code packages fit together. Data flow, dependencies, extension seams.
3. **[AGENT_RUNTIME.md](AGENT_RUNTIME.md)** — How characters are implemented (pi-agent).
4. **[RULE_COMPILER.md](RULE_COMPILER.md)** — Natural language → enforceable rules.
5. **[CLI.md](CLI.md)** — CLI surface. How users interact.
6. **[RENDERING.md](RENDERING.md)** — The four visual surfaces (React Router v7 + Canvas).

## Product & Strategy

6. **[PRODUCT.md](PRODUCT.md)** — Who buys, why, how, for how much.
7. **[USER_JOURNEY.md](USER_JOURNEY.md)** — First-60-seconds experience.
8. **[EXPORT_SHARE.md](EXPORT_SHARE.md)** — How chronicles become viral content.
9. **[SCENARIO_DESIGN.md](SCENARIO_DESIGN.md)** — The craft of scenarios that produce drama.
10. **[METRICS.md](METRICS.md)** — What we measure, what healthy looks like.
11. **[ROADMAP.md](ROADMAP.md)** — Milestones and timing.
12. **[COMPETITION.md](COMPETITION.md)** — Landscape, moats, risks.
13. **[DIFFERENTIATION.md](DIFFERENTIATION.md)** — Honest accounting of how Chronicle differs from Smallville / AI Town / Concordia / AgentSociety.
14. **[RELATED_WORK.md](RELATED_WORK.md)** — Landscape map of prior art.

## Operations & Responsibility

13. **[COST_MODEL.md](COST_MODEL.md)** — Economics of running and charging.
14. **[FAILURE_MODES.md](FAILURE_MODES.md)** — What breaks, how we recover.
15. **[TESTING.md](TESTING.md)** — How we validate anything works.
16. **[GOVERNANCE.md](GOVERNANCE.md)** — Safety, moderation, legal stance.
17. **[DATA_PRIVACY.md](DATA_PRIVACY.md)** — What we collect, why, and user rights.

---

## Example Scenarios (stress-tests for the design)

- **[../examples/dinner-party.chronicle.md](../examples/dinner-party.chronicle.md)** — 8 people with secrets, one party
- **[../examples/desert-island.chronicle.md](../examples/desert-island.chronicle.md)** — Survival + murder mystery
- **[../examples/startup-founders.chronicle.md](../examples/startup-founders.chronicle.md)** — 5 co-founders, 180-day runway
- **[../examples/high-school.chronicle.md](../examples/high-school.chronicle.md)** — 20 students, one transfer, cliques collide

---

## Reading Paths

### "I'm a founder/exec"
1. README.md
2. DESIGN.md
3. PRODUCT.md
4. COMPETITION.md
5. ROADMAP.md

### "I'm implementing this"
1. DESIGN.md
2. SCHEMA.sql
3. AGENT_RUNTIME.md
4. RULE_COMPILER.md
5. CLI.md
6. Pick one example, read it end-to-end

### "I'm a designer"
1. RENDERING.md
2. USER_JOURNEY.md
3. EXPORT_SHARE.md
4. SCENARIO_DESIGN.md

### "I'm in policy / legal / ops"
1. GOVERNANCE.md
2. DATA_PRIVACY.md
3. FAILURE_MODES.md
4. TESTING.md

### "I'm investing / evaluating"
1. README.md
2. DESIGN.md
3. PRODUCT.md
4. COST_MODEL.md
5. METRICS.md
6. COMPETITION.md
7. ROADMAP.md

---

## Status

All design docs complete as of 2026-04-16.

Code skeleton: `package.json`, `tsconfig.base.json`, core types, engine skeleton, rule enforcer skeleton, agent pool skeleton, CLI skeleton, first example compiled.

Next: implementation phase. Start with SCHEMA migrations + core types + CLI `create-world` wired up to real Pi agent.

---

## Maintenance

- Every feature added → docs updated
- Quarterly review of all docs for accuracy
- Outdated sections flagged with `⚠ NEEDS UPDATE` in frontmatter
- Version this index alongside the project version
