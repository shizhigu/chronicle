# 0004. React Router v7 for the dashboard (not Next.js)

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** Chronicle core team

## Context

Chronicle's dashboard renders a live simulation: a canvas showing agents moving, a sidebar with speech bubbles, a gazette tab with the narrator's summary, and a replay mode that scrubs through historical ticks. It streams events over WebSockets from the engine.

We need a React framework that:

- Supports file-based routing with nested layouts (for the `chronicle/:id/live`, `.../gazette`, `.../whispers` sub-routes).
- Ships a loader / action abstraction so the "same code runs on server for initial HTML, then hydrates to WS" pattern is natural.
- Plays nicely with Bun as the dev runtime.
- Has a long-lived, healthy upstream.
- Is not so opinionated that it fights us on the things we care about (streaming data, custom server, canvas rendering).

## Decision

Use **React Router v7 (formerly Remix)** as the dashboard framework, with Vite as the dev server and Bun as the runtime host.

Routes live in `packages/dashboard/app/routes/`. We use file-based routes with nested layouts. WebSocket event streams from the engine bridge are consumed via client-side hooks — the loader handles the initial HTML / data, the hook takes over for live updates.

## Rationale

- **Remix lineage.** React Router v7 inherits Remix's loader / action story, which is a clean fit for "load initial state, then subscribe to live updates."
- **No vendor lock-in.** Plain React, Vite, Bun — no framework-specific deploy target or build pipeline that would tie us to a cloud.
- **Non-SSR friendly.** We can ship the dashboard as a static build served by the CLI, which is the 90% case for local use.
- **Maintained by the React Router team.** The library has been around longer than most of React's own major versions; upstream risk is low.
- **Bun compatibility is first-class.** `bun run react-router dev` works today; no workarounds required.
- **Straightforward canvas integration.** We use Konva + react-konva for the animated 2D view; neither the framework nor the bundler gets in the way.

## Alternatives considered

- **Next.js 15.** Powerful, but opinionated toward Vercel deploy, RSC pushes complexity we do not need for a local-first app, and the dev server experience on Bun has been historically rougher than RR v7. The RSC boundary conceptually clashes with streaming canvas-animation workloads.
- **Vite + React Router v6 (library mode).** Lighter, but loses the loader pattern and server-side rendering for the initial load, which matters for quick first paint when the dashboard hosts a fork / import flow.
- **SvelteKit / SolidStart.** Excellent frameworks, but we already have React expertise on the team and no countervailing win.
- **Plain React SPA, no framework.** Viable but we'd re-implement nested routes + loaders ourselves.

## Consequences

### Positive
- Loaders handle initial data fetch; live updates come from WS — clean separation.
- Nested routes match our tabbed dashboard naturally.
- Static build is deployable as "open `index.html` and point it at `ws://localhost:…`" in the simplest case.
- Framer Motion, Zustand, Konva all integrate cleanly.

### Negative
- **Smaller ecosystem vs. Next.js.** Fewer third-party components assume React Router specifically. Rarely bites; when it does, the primitives are plain React.
- **RSC not used.** If we later want server components for a hosted multiplayer dashboard, we would need to revisit.

### Neutral / accept
- Dashboard is a separate package (`@chronicle/dashboard`) and does not block CLI users who never open it.

## Revisit triggers

- React Router v7 stops receiving updates, or drops Bun compatibility.
- RSC becomes load-bearing for a feature we want (e.g., server-side AI inference in the dashboard).
- We build a true multiplayer dashboard where RSC's data-fetching story would materially simplify the code.

## Related

- [`docs/RENDERING.md`](../RENDERING.md) — full dashboard design, including canvas architecture.
- [0001. Use Bun as the runtime](0001-bun-runtime.md).
