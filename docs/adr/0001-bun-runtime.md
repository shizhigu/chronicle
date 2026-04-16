# 0001. Use Bun as the runtime, package manager, and test runner

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** Chronicle core team

## Context

Chronicle is a TypeScript monorepo with six packages, a CLI, a dashboard, and an event-sourced SQLite data layer. The project must be easy for contributors to set up (ideally one install command), fast to iterate on (tests, typecheck, build), and robust across macOS / Linux / Windows.

Historically, projects like this pick Node.js + npm/pnpm/yarn + tsx/ts-node + vitest + better-sqlite3 + `ws` + ESLint + Prettier + Husky — a stack of 8+ tools where most friction is in the seams between them.

We need to pick a baseline runtime and tool chain before the project grows further.

## Decision

Use **Bun 1.1+** as the single runtime for development, testing, and the published CLI. Specifically:

- **Package manager:** `bun install` (replaces npm / pnpm / yarn).
- **Script runner:** `bun run …` (replaces npm-scripts with faster startup).
- **Test runner:** `bun test` (replaces vitest — API-compatible for `describe` / `it` / `expect`).
- **TypeScript execution:** `bun run src/index.ts` (replaces tsx / ts-node).
- **Bundler:** `bun build` where bundling is needed (replaces tsc's flat output for CLI binaries).
- **SQLite:** built-in `bun:sqlite` (replaces `better-sqlite3` — no native-module rebuild step).
- **HTTP + WebSocket server:** built-in `Bun.serve` (replaces `ws` + `express` / `fastify`).

We still use TypeScript, Biome, Lefthook, Drizzle ORM, React Router v7, pi-agent, and Zod — all of which work natively on Bun.

## Rationale

1. **One tool, one install.** `bun install && bun test && bun run build` — three commands cover 95% of contributor workflows, no post-install scripts, no Xcode / build-essential dance for native modules.
2. **Startup speed.** Bun's TS loader + cold-start time is roughly an order of magnitude faster than tsx or ts-node, which compounds across `bun test --watch` iterations.
3. **Batteries-included stdlib.** `bun:sqlite`, `Bun.serve`, `Bun.file`, `Bun.hash`, `Bun.password` — every one of these removes a transitive dep with its own CVE surface.
4. **Runtime compatibility.** Bun implements most of Node's stdlib; our non-Bun-specific code runs in Node too (important for libraries that consumers may embed).
5. **npm registry compatibility.** All our deps publish to npm and work as-is; no ecosystem switch.

## Alternatives considered

- **Node.js + pnpm + tsx + vitest.** Mature, well-documented, but requires 5+ tools in combination. We already know this works — but we have lived through the integration friction and prefer to escape it.
- **Deno.** Excellent TS ergonomics and built-in tooling, but npm-compat is still a friction point for some of our deps (notably pi-agent and Drizzle), and the ecosystem is smaller than Bun's at the time of writing.
- **Node 22 + `node --run`.** Node's native TS support is in progress but incomplete as of this writing; `node --run` covers scripts but not test running or bundling.

## Consequences

### Positive
- New-contributor setup is effectively `curl -fsSL https://bun.sh/install | bash && bun install`.
- CI is simpler: one `setup-bun` action, no matrix of tool versions.
- We remove `better-sqlite3` and `ws` from the dependency tree — both are native / widely-linked, both historically painful on Windows.
- Test startup is fast enough that we can default to running the full suite pre-push via Lefthook.

### Negative
- **Windows native** support on Bun is improving but has had rough edges historically; our CI matrix includes Windows to catch regressions early.
- **Ecosystem tooling lag.** A few tools (older coverage reporters, some Jest plugins) assume Node; we must vet deps for Bun compatibility before adding them.
- **Library authors' choice constraint.** Publishing `@chronicle/engine` to npm, downstream consumers may run on Node — we test the published builds on both runtimes to keep that promise.

### Neutral / accept
- We pin `packageManager: "bun@1.1.x"` in `package.json` to give contributors a clear version signal.

## Revisit triggers

- Bun ships a breaking change to `bun:sqlite` or `Bun.serve` that materially affects us.
- Node.js native TS + test runner reach feature parity and surpass Bun on our benchmark.
- A critical dep we depend on (pi-agent, Drizzle, React Router) drops Bun support.
- Sustained flakiness on a supported OS that we cannot root-cause within 90 days.

## Related

- [0003. SQLite + event-sourced world state](0003-sqlite-event-sourced.md)
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — contributor setup instructions that embody this decision.
