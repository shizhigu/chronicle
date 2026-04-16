# Security Policy

Chronicle takes security seriously. Thank you for helping keep the project and its users safe.

---

## Supported Versions

| Version    | Status                         |
|------------|--------------------------------|
| `0.1.x`    | Alpha — security fixes land in the next patch release |
| `< 0.1`    | Unsupported                    |

Once Chronicle reaches `1.0`, we will maintain security patches for the latest minor version and one prior minor version.

---

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, email **security@chronicle.sh** with:

1. A clear description of the vulnerability.
2. Steps to reproduce (a minimal proof-of-concept is ideal).
3. The impact — what an attacker could achieve.
4. Your proposed fix, if you have one.
5. Whether you want public credit in the advisory.

You can encrypt sensitive reports with our PGP key published at [chronicle.sh/security.asc](https://chronicle.sh/security.asc).

### Response Timeline

| Step                           | Target        |
|--------------------------------|---------------|
| Acknowledgement of your report | within 48h    |
| Initial triage + severity rating | within 7 days |
| Fix released (critical / high) | within 14 days |
| Fix released (medium / low)    | next scheduled release |
| Public disclosure              | after fix + 30 days, or by mutual agreement |

We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure): we work with you on a fix and timeline, then publish an advisory crediting you (unless you prefer anonymity).

---

## Scope

### In scope

- `@chronicle/core`, `@chronicle/engine`, `@chronicle/runtime`, `@chronicle/compiler`, `@chronicle/cli` — the published npm packages
- The dashboard package (`@chronicle/dashboard`)
- Any official Docker images we publish
- Sample scenarios in `examples/` (if they contain unsafe defaults)

### Out of scope

- User-written scenarios that configure Chronicle unsafely (e.g., granting a tool arbitrary shell access). That is a deployment issue, not a framework vulnerability.
- Third-party LLM providers' content filtering (OpenAI, Anthropic, etc.). Report those to the provider.
- Vulnerabilities in unmaintained forks.
- Rate-limiting of the hosted dashboard (if we offer one) — open a regular issue.

---

## Threat Model

Chronicle is designed for local, single-operator use. Running it in multi-tenant mode or exposing the WebSocket bridge to the public internet is **your responsibility** and outside the default threat model.

Specifically, the default setup assumes:

- The operator trusts scenarios they compile.
- Agent outputs (LLM text) may be untrusted — Chronicle sanitizes before displaying and never `eval()`s them.
- The SQLite database sits on a filesystem the operator controls.
- LLM API keys live in the operator's environment and never leave the local process.

If you're building a hosted Chronicle product, see [`docs/DATA_PRIVACY.md`](docs/DATA_PRIVACY.md) and [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md) for additional controls.

---

## Common Classes of Issues We Care About

- **Prompt injection** that bypasses rule enforcement (e.g., an agent convinces the LLM-judge to ignore a soft rule).
- **SQL injection** in compiled rule predicates or scenario metadata.
- **Path traversal** in `.chronicle` file import / export.
- **Sandbox escape** if we ever add user-supplied code execution (we don't today).
- **Denial of service** in the compiler via crafted scenario descriptions.
- **Token / API-key leakage** through logs, snapshots, or shared `.chronicle` exports.

---

## Not a Vulnerability

These are known characteristics, not bugs:

- An LLM can produce offensive or nonsensical output. That is an LLM-provider concern; Chronicle surfaces it in the dashboard exactly as the model returned it (after basic content filtering configured in `safety.yml`).
- Chronicle consumes API tokens proportional to simulation length. Runaway costs are budgeted via `god_budget_tokens`; exceeding that budget pauses the world. Report budget-bypass bugs, not "the simulation costs money."
- Deterministic replays may diverge if the LLM provider changes model versions. Chronicle records model IDs in snapshots so you can detect this.

---

## Recognition

Every confirmed, in-scope report earns credit in the published advisory and a line in `SECURITY_THANKS.md`. Researchers who request anonymity are honored.

We do not currently offer paid bounties. When Chronicle becomes commercially funded, we will revisit this.

---

Thank you for helping make Chronicle safer.
