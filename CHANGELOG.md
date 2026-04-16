# Changelog

All notable changes to Chronicle are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Chronicle adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

User-facing entries in this file are generated from [changesets](https://github.com/changesets/changesets) — run `bun run changeset` when a PR affects released behavior.

---

## [Unreleased]

### Added
- Initial monorepo scaffold with six packages: `core`, `engine`, `runtime`, `compiler`, `cli`, `dashboard`.
- Complete SQLite schema (`schema/SCHEMA.sql`) for event-sourced world state.
- Three-tier rule system: hard (engine-enforced predicates), soft (LLM-judge norms), economic (cost formulas).
- pi-agent-based agent pool (`@mariozechner/pi-agent-core`).
- React Router v7 dashboard scaffold with live/gazette/whispers/reel tabs.
- Natural-language world compiler with Zod-validated output.
- Four example scenarios: dinner party, desert island, startup founders, high school.
- 18 architectural design documents under `docs/`.
- Bun-first development workflow: `bun test`, `bun run build`, Biome for lint/format, Lefthook for git hooks.
- Conventional Commits enforced via `lefthook.yml`.
- OSS scaffolding: `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CONTRIBUTING.md`, issue/PR templates, CI workflows.
- Architecture Decision Records under `docs/adr/`.

### Changed
- _(none yet — pre-release)_

### Deprecated
- _(none yet — pre-release)_

### Removed
- _(none yet — pre-release)_

### Fixed
- _(none yet — pre-release)_

### Security
- _(none yet — pre-release)_

---

## Versioning Policy

| Change                                         | Bump    |
|------------------------------------------------|---------|
| Breaking API change to `@chronicle/*` packages | major   |
| New feature, new tool, new rule tier           | minor   |
| Bug fix, internal refactor, doc improvement    | patch   |
| Pre-1.0 — minor bumps may include breaks       | minor   |

Pre-1.0 rules of thumb: `0.Y.Z` — `Y` bumps on any user-visible change; `Z` bumps on internal-only fixes. We will commit to strict semver on `1.0`.

---

## Unreleased → Release Process

1. Open PR with changeset: `bun run changeset`
2. On merge to `main`, the **Release** workflow opens a version PR accumulating all pending changesets.
3. When maintainers merge the version PR, packages are published to npm and this file is updated automatically.

See `.github/workflows/release.yml`.
