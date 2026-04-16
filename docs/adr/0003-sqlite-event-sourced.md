# 0003. SQLite + event-sourced world state

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** Chronicle core team

## Context

A Chronicle world is a long-running simulation that produces a lot of state: agents, locations, resources, relationships, memories, intervention queues, and a continuous stream of events (movements, messages, actions). Users want to:

- Pause, resume, and **fork** a simulation at any tick.
- **Replay** deterministically for debugging.
- **Share** a world file with a friend so they see the same story.
- Run entirely **offline and locally** — no server required for the common case.
- Inspect the database directly with standard tooling when things go wrong.

We must pick a persistence strategy that supports all of this without forcing a server dependency.

## Decision

Persist world state in a **single SQLite file per world**, and treat the `events` table as the authoritative log. Derived tables (current agent location, resource ownership, relationship scores) are maintained as we go but are reconstructible from `events` alone. The canonical on-disk format — the `.chronicle` file — is literally a SQLite database with a specific schema.

Concretely:

- SQLite via `bun:sqlite` (see [ADR 0001](0001-bun-runtime.md)).
- Schema in `schema/SCHEMA.sql`; typed with Drizzle ORM (`drizzle-orm/bun-sqlite`).
- `events` is the append-only ground truth; every mutation writes an event.
- `tick_snapshots` periodically checkpoints the derived state for fast resume and fast seek-to-tick.
- Exporting a world = `sqlite3 world.db .dump | gzip > world.chronicle` (with a header record identifying it as a Chronicle file).

## Rationale

- **Zero-install server.** SQLite is a file. Anyone can open, copy, fork, move, delete. `cp` is a perfectly valid sharing mechanism.
- **Event-sourcing maps cleanly to LLM-driven simulations.** Every tool call an agent makes is conceptually an event; persisting it is free if that is also how we reconstruct state.
- **Forkability is first-class.** "Fork world at tick 42" means "clone the DB file and truncate events after tick 42" — a few SQL statements, no distributed coordination.
- **Deterministic replays** are trivial when seed + event log are both stored in the same DB.
- **Inspectability.** `sqlite3 world.db` is a debugging tool every developer already has.
- **Bun built-in.** We use `bun:sqlite` — no native-module rebuild, no Windows build-tools ritual.

## Alternatives considered

- **Postgres + event sourcing.** More powerful, but adds a server dependency and makes "share a world file" awkward. Overkill for single-operator simulations; overkill even for a hosted product at the scale we target.
- **JSON files + append-log.** Simple to start, but querying becomes pathological fast (e.g., "all events visible to agent X between ticks 100 and 200").
- **Document DB (MongoDB / local LevelDB).** Loses relational integrity for our foreign-key-heavy schema (agents → locations, resources → owners), and complicates replay.
- **Pure in-memory with periodic snapshots.** Loses the long-running resumable property we want.

## Consequences

### Positive
- Export / import is `cp`; forking is `sqlite3 .backup`.
- Replays are bit-exact given the same LLM responses (which we also log in `events`).
- Migrations are plain SQL, versioned in `schema_version`.
- Backup is trivial — SQLite WAL + `sqlite3 .backup` works.

### Negative
- **Single-writer constraint.** SQLite serializes writes within a single file. For our tick loop this is fine — the engine is the only writer per world — but multi-world hosted deployments need one DB per world, not one DB shared across worlds.
- **Concurrency ceiling.** If we ever want many concurrent writers on one world (e.g., collaborative Chronicle editor), SQLite is not the right store. We would need to evolve.
- **Binary blobs** (agent session state) live in the same file — can make the DB sizable. Mitigated by pragma `page_size`, periodic `VACUUM`, and optional snapshots stored externally. (Character memory does *not* sit in the DB — it lives in per-character markdown files managed by `MemoryFileStore`.)

### Neutral / accept
- We use WAL mode + `synchronous=NORMAL` for writer throughput; this means a process crash can lose the last few events. Acceptable for a simulation; documented in `docs/ARCHITECTURE.md`.

## Revisit triggers

- A hosted-multiplayer product becomes a primary use case (not just a single-operator tool).
- A world grows beyond ~10 GB in practice — SQLite handles it, but UI responsiveness may not.
- We need cross-process sharding of a single world.

## Related

- [0001. Use Bun as the runtime](0001-bun-runtime.md) — enables `bun:sqlite`.
- [`docs/EXPORT_SHARE.md`](../EXPORT_SHARE.md) — the `.chronicle` file format.
- [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) — full data-flow diagrams.
