# 0012. Transport-layer redaction for API keys and tokens

- **Status:** accepted
- **Date:** 2026-04-16
- **Deciders:** Chronicle core team

## Context

Chronicle stores and broadcasts event streams and HTTP state dumps
containing free-form text written by users (personas, rationales,
intervention descriptions, agent messages) and by LLMs (speech,
reflections, memory entries). Any of that text can accidentally
contain secrets:

- A user seeds a world with a persona that mentions "my API key is
  sk-ant-..."
- An LLM under an unlucky prompt writes "I tried `curl -H
  'Authorization: Bearer ghp_...`'" in a message.
- A reflection regurgitates a system prompt snippet that happened to
  include a key.
- A GitHub Actions-style scenario has a character literally named
  after an AWS access key.

These are low-probability but high-impact. The WebSocket bridge
fans events out to every dashboard client the moment they fire; the
state-server serves full JSON to whoever has a browser. Once a
secret reaches a browser dev-tools console or a persistent tab, it
is effectively gone.

## Decision

Add a small **transport-layer redactor** to `@chronicle/core`,
called on outbound paths only:

- `WebSocketBridge.sendTo` — before `JSON.stringify`.
- `WorldStateServer.json()` — before writing the response body.
- `chronicle intervene` CLI echo and similar stdout paths (future).

**Storage keeps the original text** — the event log and DB rows are
authoritative for replay and audit. We redact at the exit, not at
ingest. This preserves the "replayable given same LLM responses"
invariant from ADR-0003 and lets operators who know what they're
doing run offline tooling against the raw DB.

### Scope

- Regex-match known API-key prefixes + invisible unicode +
  `Authorization: Bearer ...` headers + `API_KEY=...` env-var
  assignments. Seed the pattern list from hermes-agent's `redact.py`
  (MIT-compatible; attributed in the file).
- **Short tokens (< 18 chars total)**: fully masked (`[REDACTED]`).
  Too short to be safely partial.
- **Long tokens (≥ 18 chars)**: keep the first 6 and last 4 chars
  for debuggability (`sk-ant-******...xyz1`). Matches hermes's
  convention.
- **Deep-walk JSON** — the redactor descends into arrays and nested
  objects so event `data.args.content` is covered even when the
  outer event shape doesn't know about secrets.

### Env disable

`CHRONICLE_REDACT=0` or `CHRONICLE_REDACT=false` turns redaction off
for debugging. The decision is sampled once at module load (same
pattern as hermes's `HERMES_REDACT_SECRETS`) so a runaway tool-call
can't `export CHRONICLE_REDACT=0` mid-process.

## Non-goals

- **Redacting at storage**. That would break replay and make the
  original `.chronicle` archive non-portable. Operators who export
  archives for public sharing should run a separate redaction pass
  on the file; this feature doesn't try to replace that.
- **Semantic PII (names, addresses, phone numbers)**. We cover only
  unambiguous secrets — things with distinctive prefixes or shapes.
  PII scrubbing is a separate concern with different tradeoffs.
- **LLM-based redaction**. Expensive, non-deterministic, slow. Regex
  is 99% of what matters for 0% of the cost.

## Composition with prior work

- **ADR-0003** (event-sourced SQLite): storage is unchanged. Replay
  is unaffected.
- **ADR-0009/L2** (governance effects): god interventions that arrive
  as text descriptions get redacted on echo but not on application
  — the compiled `Effect` payload in DB still carries raw
  references, only the broadcast to agents / dashboards is masked.
- **Memory threat-scan** (in `MemoryFileStore`): memory writes
  already reject content matching certain patterns at *ingest*.
  Transport redaction is the complementary defense for content that
  legitimately contains something scary-looking.

## Consequences

### Positive

- **Closes a live-dashboard leak path** with one small module.
- **Reusable outside Chronicle**: `@chronicle/core/redact` is a
  plain function that can be imported by any consumer (CLI tools,
  custom dashboards, scripts).
- **Cheap**: regex over already-small JSON payloads. Not a hotspot.

### Negative

- **False positives** will mask a string that happens to look like a
  key (e.g., a user deliberately writing "sk-" in a fictional
  hacker story). Partial masking keeps enough for the reader to
  tell it's a redaction artifact, not a bug. Acceptable.
- **Pattern drift**: new providers ship new key prefixes. The
  pattern list needs occasional top-ups. We version the file and
  add a pattern test per provider so a regression would fail CI.

### Neutral / accept

- Transport layer only. If a user runs `sqlite3` against the DB,
  they see raw text. That's correct — they're authenticated, they
  have root on the file, and they took the explicit action.

## Implementation plan

1. `packages/core/src/redact.ts` — module with `redact(string)`,
   `redactEvent<E>(e: E): E`, exported `REDACTION_ENABLED` flag.
2. Wire into `WebSocketBridge.sendTo` (one line).
3. Wire into `WorldStateServer.json()` (one line).
4. Tests: per-pattern unit coverage, integration through WS bridge
   and state-server.
5. Code review.

## Revisit triggers

- A real secret leaks in a test / staging world — add the pattern.
- False-positive rate becomes annoying for creative-writing
  scenarios — consider a world-config opt-out.
- Latency on hot dashboards shows redaction as a non-trivial
  fraction — the regex list is large enough to matter; profile and
  consolidate.
