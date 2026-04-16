# Getting help with Chronicle

Thanks for using Chronicle. If you are stuck, this is the fastest way to get help.

---

## Before asking

1. **Check the docs.** `docs/INDEX.md` links every design doc; `README.md` covers the happy path.
2. **Search closed issues.** Someone may have hit the same wall.
3. **Try the latest `0.1.x`.** Pre-release bugs are fixed fast; your problem may already be solved.
4. **Reduce to a minimum reproduction.** A 10-line scenario that fails is ten times more debuggable than a 500-line one.

---

## Where to ask

| Question type                         | Where                                                                 |
|---------------------------------------|-----------------------------------------------------------------------|
| "How do I…" / "Is this possible?"     | [GitHub Discussions](https://github.com/chronicle-sh/chronicle/discussions) |
| "Something is broken / crashes"       | [GitHub Issues](https://github.com/chronicle-sh/chronicle/issues) using the bug template |
| "I want a new feature"                | Open a Discussion first; we'll convert to an issue if it fits        |
| "I want to share a scenario"          | [Scenario template issue](https://github.com/chronicle-sh/chronicle/issues/new?template=scenario.yml) |
| Live chat, showcases, brainstorms     | [Discord](https://chronicle.sh/discord)                               |
| Security vulnerability                | **security@chronicle.sh** (see `SECURITY.md`) — do not file publicly |

---

## Writing a good issue

A maintainer's first read of your issue decides how fast you get help. Include:

- **What you expected** and **what happened** — one sentence each.
- **Exact versions**: `chronicle --version`, `bun --version`, OS.
- **The CLI command you ran** and any redacted relevant log output.
- **The scenario description or Chronicle file** if the bug is scenario-specific.
- **A reproduction path** — ideally three numbered steps.

Templates at `.github/ISSUE_TEMPLATE/` walk through this automatically.

---

## What to expect

- Bug triage happens **weekly**. Confirmed bugs get a milestone.
- Feature discussions stay open until scope is clear; then they become tracked issues.
- Contributors who want to fix their own issue get priority review.

We are a small team and an alpha project. Kindness and patience on both sides go a long way. Thanks for helping Chronicle improve.
