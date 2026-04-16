# Architecture Decision Records (ADRs)

This directory captures **load-bearing architectural choices** for Chronicle — the kind of decisions that shape everything downstream and that future contributors (and future us) will want to understand rather than merely observe in the code.

We follow a lightweight ADR format, loosely based on [Michael Nygard's template](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

---

## When to write an ADR

Write one when:

- You are locking in a choice that will be expensive to reverse.
- You are saying "no" to an obvious alternative and want to capture why.
- You are introducing a concept that will appear in multiple places and needs a shared vocabulary.

Do **not** write one for:

- Routine refactors.
- Taste-level style preferences (those go in `CONTRIBUTING.md` or Biome config).
- Temporary workarounds (those go in the code comment at the workaround site).

---

## Lifecycle

| Status       | Meaning                                                  |
|--------------|----------------------------------------------------------|
| `proposed`   | Up for discussion in a PR.                               |
| `accepted`   | Decision made. Code reflects it.                         |
| `superseded` | A later ADR replaced this one. Do not delete — link.     |
| `deprecated` | Still technically true but we no longer endorse it.      |

A superseded ADR has a link to the ADR that replaced it. A replacing ADR has a link back.

---

## Writing an ADR

1. Copy `TEMPLATE.md` to `NNNN-short-title.md` where `NNNN` is the next zero-padded number.
2. Fill in the sections. One page is plenty — if you need more, you probably have two ADRs.
3. Open a PR. Discuss. Merge when the team agrees.
4. Add the new ADR to the index below.

---

## Index

| #    | Title                                                    | Status    |
|------|----------------------------------------------------------|-----------|
| 0001 | [Use Bun as the runtime, package manager, and test runner](0001-bun-runtime.md) | accepted |
| 0002 | [Use pi-agent as the LLM-agent runtime (not Claude Agent SDK)](0002-pi-agent-runtime.md) | accepted |
| 0003 | [SQLite + event-sourced world state](0003-sqlite-event-sourced.md) | accepted |
| 0004 | [React Router v7 for the dashboard (not Next.js)](0004-react-router-v7.md) | accepted |
| 0005 | [Three-tier rule system: hard, soft, economic](0005-three-tier-rules.md) | accepted |
| 0006 | [TypeScript strict mode, all the way down](0006-typescript-strict.md) | accepted |
| 0007 | [Natural language is the primary configuration surface](0007-natural-language-config.md) | accepted |

---

## Related reading

- [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) — the current architecture in one place.
- [`docs/DESIGN.md`](../DESIGN.md) — the long-form design rationale.
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — how to propose changes.
