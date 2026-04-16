# Contributing to Chronicle

First: thank you. Open-source projects live on contributors.

This guide explains how to contribute effectively. It's short by design — we believe in low-friction collaboration.

---

## Quick Start

```bash
# Prerequisites: Bun >= 1.1.0
curl -fsSL https://bun.sh/install | bash

# Clone + install
git clone https://github.com/chronicle-sh/chronicle
cd chronicle
bun install

# Build all packages
bun run build

# Run tests
bun test

# Watch mode for dev
bun test --watch

# Optional: enable live LLM integration tests (costs a fraction of a cent).
# Uses OpenRouter's deepseek/deepseek-v3.2 with hard token caps + temp=0.
# Tests auto-skip when the env var is unset, so the default dev flow is free.
export OPENROUTER_API_KEY=sk-or-...
bun test packages/compiler/test/integration
```

---

## What We're Looking For

### ✅ Good first contributions
- New **preset scenarios** in `examples/` (see `docs/SCENARIO_DESIGN.md`)
- Documentation improvements (typos, clarity, examples)
- Bug fixes with tests
- New **rendering themes** (gazette templates, map biomes)
- Additional **action schemas** for existing worlds

### 🧠 Bigger contributions
- New rule tiers or enforcement mechanisms
- New agent runtime adapters (OpenAI-direct, LM Studio, etc.)
- Dashboard visualization improvements
- Performance optimizations

### ⚠️ Before starting large work
**Open an issue first.** We'll discuss scope, approach, and fit. Nothing worse than a week of work on a direction we can't merge.

---

## Development Workflow

### 1. Fork and branch

```bash
git checkout -b feat/my-feature
```

Branch names: `feat/...`, `fix/...`, `docs/...`, `refactor/...`, `test/...`

### 2. Write code + tests

**Every PR needs tests.** No exceptions. See `docs/TESTING.md` for our testing tiers.

- Unit tests in `packages/*/test/*.test.ts`
- Integration tests in `packages/engine/test/integration/`
- E2E tests in `test/e2e/`

### 3. Run quality gates locally

```bash
bun test              # all tests pass
bun run typecheck     # TypeScript happy
bun run lint          # Biome clean
```

### 4. Commit (Conventional Commits required)

Format: `<type>(<scope>)!: <subject>`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

Examples:
- `feat(engine): add reflection cycle for long runs`
- `fix(runtime): handle pi-agent timeout gracefully`
- `docs(scenario-design): add example of power-imbalance rules`
- `test(store): add coverage for god intervention queue`

**Lefthook (pre-commit) enforces this format.** Run `bun run prepare` once to install.

### 5. Add a changeset (for user-facing changes)

```bash
bun run changeset
```

Pick packages affected, pick bump (`patch` / `minor` / `major`), write a user-facing changelog entry.

Not every commit needs a changeset. Only things that affect released behavior.

### 6. Push and open PR

- Reference the issue (`Closes #123`)
- Fill in the PR template
- Be patient — maintainers triage weekly

---

## Code Style

- **Biome** enforces formatting + lints. Don't fight it.
- **TypeScript strict** mode. No `any` except where genuinely needed (prefer `unknown`).
- **Functional where reasonable** — pure functions preferred, mutation where clearer.
- **Descriptive names** over clever ones.
- **Comments explain why, not what.**
- **Small files over monoliths.** A file doing 3 things should be 3 files.

---

## Architecture Boundaries

Read `docs/ARCHITECTURE.md` before touching package structure.

Key invariant: the **dependency graph is acyclic**. `core` depends on nothing, `engine` on core, etc. Adding a new cross-package dep requires review.

Never:
- Import from `packages/cli/` in `packages/engine/`
- Import from `packages/dashboard/` anywhere server-side
- Add a runtime dep on a specific LLM provider in `@chronicle/engine`

---

## Adding Dependencies

Bun is our package manager. Use it:

```bash
bun add <pkg> --filter=@chronicle/engine
bun add -d <pkg>             # dev dep at root
```

Before adding a dependency, check:
- Is it maintained (last commit < 1 year)?
- Is it license-compatible (MIT / Apache 2.0 / BSD)?
- Could we avoid it with ~30 LOC?

Fewer deps = fewer breakages.

---

## Writing Tests

See `docs/TESTING.md` for the full strategy. TL;DR:

- **Use `bun:test`** — API compatible with vitest's `describe`/`it`/`expect`.
- **In-memory SQLite** for store tests: `await WorldStore.open(':memory:')`
- **Mock LLM** for compiler tests: pass a custom `Llm` implementation
- **Never hit real APIs** in unit tests

Target: >80% line coverage across `core`, `engine`, `runtime`, `compiler`.

---

## Scenario Contributions

Adding new example scenarios is high-value. Process:

1. Create `examples/<name>.chronicle.md` with the documented structure (see existing examples)
2. Verify it compiles cleanly (`chronicle create-world --desc '<paste description>'`)
3. Run it 5 seeds × 100 ticks, note drama scores
4. If median drama >= 6.0, open PR. If lower, iterate on personas/rules.

Include in PR:
- Natural-language description used
- 3 example highlight moments from test runs
- Any new action schemas the scenario uses

---

## Community

- **Discord**: [chronicle.sh/discord](https://chronicle.sh/discord) — live chat, help, showcases
- **Discussions**: [GitHub Discussions](https://github.com/chronicle-sh/chronicle/discussions) — ideas, questions
- **Issues**: [GitHub Issues](https://github.com/chronicle-sh/chronicle/issues) — bugs, feature requests

We default to kindness. Be patient. Explain your context. Assume good intent.

See our [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## Security

Security bugs: **do not open a public issue**. Email security@chronicle.sh.

See `SECURITY.md`.

---

## License

By contributing, you agree your contributions are licensed under MIT (same as the project).

---

## Recognition

Every non-trivial contributor gets added to `CONTRIBUTORS.md`. We use [all-contributors](https://allcontributors.org/) for attribution. PRs, docs, reviews, designs — all count.

**Thank you.** Every Chronicle you help build is a story that would never have existed otherwise.
