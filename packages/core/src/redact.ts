/**
 * Transport-layer secret redaction.
 *
 * Masks API keys, tokens, and credentials in strings before they
 * leave the process over a network / to a browser. Applied on the
 * WebSocket bridge, HTTP state-server, and CLI echo paths — see
 * `docs/adr/0012-transport-redaction.md`.
 *
 * Storage is NEVER redacted. The event log and DB rows keep the
 * original text so replay stays deterministic.
 *
 * Pattern set seeded from hermes-agent's `tools/redact.py`
 * (MIT-licensed, credited here). Add a new prefix when a new
 * provider ships one — each prefix gets a test case so the pattern
 * table can't silently rot.
 *
 * Short tokens (< 18 chars of the raw match) are fully masked.
 * Longer tokens keep the first 6 and last 4 chars for debuggability,
 * producing something like `sk-ant-******...xyz1`.
 *
 * Env disable: set `CHRONICLE_REDACT=0` (or `false`, `no`, `off`) at
 * process start to turn redaction off for debugging. The value is
 * sampled once at module load — a runaway tool-call cannot flip it
 * mid-process.
 */

/** Sample the disable switch once, at module load. */
const DISABLE_VALUES = new Set(['0', 'false', 'no', 'off']);
const RAW = process.env.CHRONICLE_REDACT?.toLowerCase() ?? '';
export const REDACTION_ENABLED = !DISABLE_VALUES.has(RAW);

// ============================================================
// Pattern table
//
// Each entry is `RegExp` matching the entire key-looking substring.
// Prefixes must be narrow enough that false-positive rates stay low;
// when in doubt, require a minimum body length.
// ============================================================

const PREFIX_PATTERNS: RegExp[] = [
  // OpenAI / OpenRouter / Anthropic (covers sk-ant-, sk-or-, sk-proj-)
  /sk-[A-Za-z0-9_-]{10,}/g,
  // GitHub
  /ghp_[A-Za-z0-9]{10,}/g,
  /github_pat_[A-Za-z0-9_]{10,}/g,
  /gho_[A-Za-z0-9]{10,}/g,
  /ghu_[A-Za-z0-9]{10,}/g,
  /ghs_[A-Za-z0-9]{10,}/g,
  /ghr_[A-Za-z0-9]{10,}/g,
  // Slack
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  // Google
  /AIza[A-Za-z0-9_-]{30,}/g,
  // AWS access key id — exactly AKIA + 16 uppercase alphanumeric, word-
  // bounded. The 4-char prefix alone is common enough in AWS resource
  // arns and test fixtures that we need the full 20-char anchored form
  // to avoid false positives.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Stripe
  /sk_live_[A-Za-z0-9]{10,}/g,
  /sk_test_[A-Za-z0-9]{10,}/g,
  /rk_live_[A-Za-z0-9]{10,}/g,
  // SendGrid
  /SG\.[A-Za-z0-9_-]{10,}/g,
  // HuggingFace
  /hf_[A-Za-z0-9]{10,}/g,
  // Replicate
  /r8_[A-Za-z0-9]{10,}/g,
  // npm / PyPI
  /npm_[A-Za-z0-9]{10,}/g,
  /pypi-[A-Za-z0-9_-]{10,}/g,
  // DigitalOcean
  /dop_v1_[A-Za-z0-9]{10,}/g,
  /doo_v1_[A-Za-z0-9]{10,}/g,
  // Other providers we see in the wild
  /pplx-[A-Za-z0-9]{10,}/g, // Perplexity
  /gsk_[A-Za-z0-9]{10,}/g, // Groq
  /tvly-[A-Za-z0-9]{10,}/g, // Tavily
  /exa_[A-Za-z0-9]{10,}/g, // Exa
  /fc-[A-Za-z0-9]{10,}/g, // Firecrawl
  /fal_[A-Za-z0-9_-]{10,}/g, // Fal.ai
  // Added post-code-review, 2026:
  /co-[A-Za-z0-9]{30,}/g, // Cohere (long-body to avoid hitting plain `co-authored` etc.)
  /csk-[A-Za-z0-9]{10,}/g, // Cerebras
  /together_[A-Za-z0-9]{20,}/gi, // Together AI
];

/** `Authorization: Bearer <token>` → `Authorization: Bearer [REDACTED]`. */
const AUTH_HEADER = /(Authorization:\s*Bearer\s+)(\S+)/gi;

/** `API_KEY=value` / `TOKEN=value` / `SECRET=value` etc. */
const ENV_ASSIGNMENT =
  /([A-Z0-9_]{0,50}(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)[A-Z0-9_]{0,50})\s*=\s*(['"]?)(\S+)\2/g;

/** JSON-style `"apiKey":"value"` / `"token":"value"` etc. */
const JSON_FIELD =
  /("(?:api_?[Kk]ey|token|secret|password|access_token|refresh_token|auth_token|bearer)")\s*:\s*"([^"]+)"/g;

// ============================================================
// Redactors
// ============================================================

/**
 * Redact a single string. Returns the same string when redaction is
 * disabled or no pattern matches. Safe to call on empty / non-secret
 * content.
 */
export function redact(input: string): string {
  if (!REDACTION_ENABLED || !input) return input;
  let out = input;

  // Prefixed tokens — pass each prefix pattern. Replace with a
  // partial mask so debuggability survives.
  for (const pattern of PREFIX_PATTERNS) {
    out = out.replace(pattern, (match) => partialMask(match));
  }

  // Authorization headers — the token is capture group 2.
  out = out.replace(AUTH_HEADER, (_m, header, token) => `${header}${partialMask(token)}`);

  // Env-style assignments — the value is capture group 3.
  out = out.replace(
    ENV_ASSIGNMENT,
    (_m, name, quote, value) => `${name}=${quote}${partialMask(value)}${quote}`,
  );

  // JSON-style fields — replace the value (capture group 2) with a fully-masked
  // placeholder. Keeping partial-mask in JSON is awkward when the value is short.
  out = out.replace(JSON_FIELD, (_m, key) => `${key}: "[REDACTED]"`);

  return out;
}

/**
 * Deep-walk a JSON value and redact every string leaf. Objects and
 * arrays are cloned lazily — if nothing changes, the original reference
 * flows through unchanged, avoiding spurious UI re-renders for consumers
 * that memoize on identity.
 *
 * Cycle-safe via a per-walk WeakSet: a self-referential payload (Express
 * req objects, Zod error trees, any debug blob that got accidentally
 * wired into an event) would otherwise recurse until stack overflow.
 * On cycle detection we return the original node unchanged — downstream
 * stringification will also fail on cycles, but that's the standard JSON
 * behavior; we just don't crash first.
 *
 * Non-string / non-object / non-array values pass through.
 */
export function redactValue<T>(value: T): T {
  if (!REDACTION_ENABLED) return value;
  return walkRedact(value, new WeakSet());
}

function walkRedact<T>(value: T, seen: WeakSet<object>): T {
  if (typeof value === 'string') {
    const redacted = redact(value);
    return (redacted === value ? value : redacted) as T;
  }
  if (value && typeof value === 'object') {
    if (seen.has(value as object)) return value; // cycle
    seen.add(value as object);
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = walkRedact(v, seen);
      if (r !== v) changed = true;
      return r;
    });
    return (changed ? (out as unknown as T) : value) as T;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = walkRedact(v, seen);
      if (r !== v) changed = true;
      out[k] = r;
    }
    return (changed ? (out as unknown as T) : value) as T;
  }
  return value;
}

// ============================================================
// Helpers
// ============================================================

const SHORT_THRESHOLD = 18;

/**
 * Mask a single token. Short ones become `[REDACTED]`; longer ones
 * keep the first 6 and last 4 characters so a human skimming a log
 * can still tell which credential they're looking at without being
 * able to reconstruct it.
 */
function partialMask(token: string): string {
  if (!token) return token;
  if (token.length < SHORT_THRESHOLD) return '[REDACTED]';
  return `${token.slice(0, 6)}${'*'.repeat(6)}...${token.slice(-4)}`;
}
