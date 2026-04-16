/**
 * Resilience — typed error classifier + jittered retry for LLM calls.
 *
 * Wraps the agent-pool's `instance.prompt()` invocations so transient
 * failures (rate limits, server errors, timeouts, network glitches)
 * don't silently gap out a character's turn. See ADR-0013.
 *
 * Two concerns, one module, because they co-evolve:
 *
 *   1. `classifyError(err)` — turn an opaque throwable into a typed
 *      `ClassifiedError` with a recovery hint. Structural, not
 *      per-provider.
 *   2. `retryWithBackoff(fn, opts)` — re-run a thunk with jittered
 *      exponential backoff, bailing the moment the classifier
 *      reports `retryable: false`.
 *
 * Replay note: jitter uses `Math.random()`, which is non-deterministic.
 * This is intentional and safe — retries only fire on real network /
 * provider failures, which never happen during an event-log replay
 * (the original LLM response is loaded from the events table). So
 * retry is a non-replay-sensitive path.
 */

// ============================================================
// Types
// ============================================================

export type FailureKind =
  | 'rate_limit'
  | 'auth'
  | 'billing'
  | 'server_error'
  | 'timeout'
  | 'context_overflow'
  | 'format_error'
  | 'not_found'
  | 'network'
  | 'unknown';

export interface ClassifiedError {
  kind: FailureKind;
  /** HTTP status if we could parse one. */
  status?: number;
  /** Human-readable message, already truncated to something log-safe. */
  message: string;
  /** Whether `retryWithBackoff` should keep trying. */
  retryable: boolean;
  /**
   * Optional extra delay from a `Retry-After` header or similar. Added
   * on top of the computed backoff so a 429 that tells us "wait 30s"
   * doesn't retry before that window elapses.
   */
  retryAfterMs?: number;
  /** Source error preserved for callers that want to inspect it. */
  cause?: unknown;
}

// ============================================================
// Classifier
// ============================================================

const RETRYABLE_KINDS = new Set<FailureKind>([
  'rate_limit',
  'server_error',
  'timeout',
  'network',
  'unknown',
]);

const MESSAGE_MAX = 500;

/**
 * Inspect a thrown value and classify it. Order matters:
 *
 *   1. Structured HTTP status (if present) — authoritative.
 *   2. Known error names / codes (AbortError, ETIMEDOUT, ECONNRESET).
 *   3. Message-substring heuristics.
 *
 * Messages that match multiple heuristics take the first hit; the
 * message itself is preserved so the caller can see the raw text.
 */
export function classifyError(err: unknown): ClassifiedError {
  const message = truncate(extractMessage(err));
  const status = extractStatus(err);
  const retryAfterMs = extractRetryAfter(err);

  // 1. Structured status takes priority — matches what every provider
  //    SDK exposes on their error objects.
  if (typeof status === 'number') {
    const kind = classifyByStatus(status);
    return {
      kind,
      status,
      message,
      retryable: RETRYABLE_KINDS.has(kind),
      retryAfterMs,
      cause: err,
    };
  }

  // 2. Error name / code — network-layer errors from fetch, DNS,
  //    socket, AbortController.
  const name = extractName(err);
  const code = extractCode(err);
  if (name === 'AbortError' || name === 'TimeoutError' || code === 'ETIMEDOUT') {
    return { kind: 'timeout', message, retryable: true, retryAfterMs, cause: err };
  }
  if (
    name === 'FetchError' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'EPIPE'
  ) {
    return { kind: 'network', message, retryable: true, retryAfterMs, cause: err };
  }

  // 3. Message substrings. Least reliable, last resort.
  const lower = message.toLowerCase();
  if (/\brate[\s_-]?limit(ed)?\b|\btoo many requests\b|\bthrottled?\b/.test(lower)) {
    return { kind: 'rate_limit', message, retryable: true, retryAfterMs, cause: err };
  }
  if (/\b(unauthori[sz]ed|invalid api[\s-]?key|missing api key|forbidden)\b/.test(lower)) {
    return { kind: 'auth', message, retryable: false, cause: err };
  }
  if (/\binsufficient credit\b|\bquota exceeded\b|\bpayment required\b/.test(lower)) {
    return { kind: 'billing', message, retryable: false, cause: err };
  }
  if (/\boverloaded\b|\bbad gateway\b|\bservice unavailable\b|\bgateway timeout\b/.test(lower)) {
    return { kind: 'server_error', message, retryable: true, retryAfterMs, cause: err };
  }
  if (/\btimeout\b|\btimed out\b/.test(lower)) {
    return { kind: 'timeout', message, retryable: true, retryAfterMs, cause: err };
  }
  if (
    /\bcontext[\s_-]?length\b|\bcontext window\b|\btoo long\b.*\btoken/.test(lower) ||
    /\bpayload too large\b/.test(lower)
  ) {
    return { kind: 'context_overflow', message, retryable: false, cause: err };
  }
  if (
    /\bmodel not found\b|\bunknown model\b|\binvalid model\b/.test(lower) ||
    // LM Studio / Ollama / local servers when no model is loaded into
    // memory: the endpoint is reachable but has nothing to serve.
    // Retrying won't help — the user (or an out-of-band `lms load`)
    // needs to load a model first.
    /\bno models? loaded\b|\bmodel .*not loaded\b|\bno model loaded\b/.test(lower)
  ) {
    return { kind: 'not_found', message, retryable: false, cause: err };
  }
  if (/\bbad request\b|\binvalid request\b|\bmalformed\b/.test(lower)) {
    return { kind: 'format_error', message, retryable: false, cause: err };
  }
  if (/\bnetwork\b|\bfetch failed\b|\bconnection\b/.test(lower)) {
    return { kind: 'network', message, retryable: true, retryAfterMs, cause: err };
  }

  // Conservative default: retry once.
  return { kind: 'unknown', message, retryable: true, retryAfterMs, cause: err };
}

function classifyByStatus(status: number): FailureKind {
  if (status === 400) return 'format_error';
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'billing';
  if (status === 404) return 'not_found';
  if (status === 408) return 'timeout';
  if (status === 413) return 'context_overflow';
  if (status === 429) return 'rate_limit';
  if (status >= 500 && status < 600) return 'server_error';
  return 'unknown';
}

// ============================================================
// retryWithBackoff
// ============================================================

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Jitter is `uniform(0, jitterRatio * computedDelay)`. */
  jitterRatio: number;
  /** Called after a failing attempt, before sleeping. */
  onRetry?: (attempt: number, err: ClassifiedError, delayMs: number) => void;
  /** Last word on whether to retry. Defaults to `err.retryable`. */
  shouldRetry?: (err: ClassifiedError) => boolean;
  /**
   * Injected sleeper for tests — defaults to real setTimeout. Tests
   * can pass a no-op to make retry loops synchronous.
   */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS: RetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  jitterRatio: 0.5,
};

/**
 * Re-run `fn` with jittered exponential backoff up to `maxAttempts`
 * times. Throws the last `ClassifiedError` if every attempt fails.
 * On the final failure the thrown object is the full classified
 * struct (not the original error) — callers can switch on `kind`.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: Partial<RetryOptions> = {},
): Promise<T> {
  const config: RetryOptions = { ...DEFAULTS, ...opts };
  const sleep = config.sleep ?? defaultSleep;
  const shouldRetry = config.shouldRetry ?? ((e) => e.retryable);

  let lastError: ClassifiedError | null = null;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const classified = classifyError(err);
      lastError = classified;

      const isLastAttempt = attempt >= config.maxAttempts;
      if (isLastAttempt || !shouldRetry(classified)) {
        throw classified;
      }

      const delayMs = computeDelay(attempt, config, classified);
      config.onRetry?.(attempt, classified, delayMs);
      await sleep(delayMs);
    }
  }

  // Unreachable — the loop always either returns or throws — but TS
  // wants the branch for narrowing. Use the last error if somehow we
  // fall through.
  throw (
    lastError ?? {
      kind: 'unknown' as FailureKind,
      message: 'retry loop exited without result',
      retryable: false,
    }
  );
}

function computeDelay(attempt: number, opts: RetryOptions, err: ClassifiedError): number {
  const exponent = Math.max(0, attempt - 1);
  // Cap applies to the exponential part only. A provider-supplied
  // Retry-After layers on top UNCAPPED — shortening it to fit our
  // cap would defeat its purpose (the provider told us exactly how
  // long to wait to avoid a rate-limit cascade).
  const baseBackoff = Math.min(opts.baseDelayMs * 2 ** exponent, opts.maxDelayMs);
  const jitter = Math.random() * opts.jitterRatio * baseBackoff;
  const extra = err.retryAfterMs ?? 0;
  return baseBackoff + jitter + extra;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Extraction helpers
// ============================================================

function extractMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || err.name;
  if (err && typeof err === 'object') {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const candidates = [
    (err as { status?: unknown }).status,
    (err as { statusCode?: unknown }).statusCode,
    (err as { response?: { status?: unknown } }).response?.status,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return undefined;
}

function extractName(err: unknown): string | undefined {
  if (err instanceof Error) return err.name;
  if (err && typeof err === 'object') {
    const n = (err as { name?: unknown }).name;
    if (typeof n === 'string') return n;
  }
  return undefined;
}

function extractCode(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const c = (err as { code?: unknown }).code;
    if (typeof c === 'string') return c;
  }
  return undefined;
}

function extractRetryAfter(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  // HTTP Retry-After header can be seconds (number string) or a date.
  // Different SDKs surface headers at different depths:
  //   - Top-level `err.headers` (plain fetch wrappers)
  //   - Nested `err.response.headers` (Anthropic SDK, several OpenAI wrappers)
  //   - As a number on `err.retryAfter` (some REST clients)
  const topHeaders = (err as { headers?: Record<string, string> }).headers;
  const nestedHeaders = (err as { response?: { headers?: Record<string, string> } }).response
    ?.headers;
  const raw =
    topHeaders?.['retry-after'] ??
    topHeaders?.['Retry-After'] ??
    nestedHeaders?.['retry-after'] ??
    nestedHeaders?.['Retry-After'];
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n * 1000;
    const date = Date.parse(raw);
    if (!Number.isNaN(date)) {
      const diff = date - Date.now();
      if (diff > 0) return diff;
    }
  }
  // Some SDKs surface it as `retryAfter` in seconds.
  const direct = (err as { retryAfter?: unknown }).retryAfter;
  if (typeof direct === 'number' && direct >= 0) return direct * 1000;
  return undefined;
}

function truncate(s: string): string {
  return s.length <= MESSAGE_MAX ? s : `${s.slice(0, MESSAGE_MAX)}…`;
}
