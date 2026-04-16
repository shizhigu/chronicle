/**
 * MemoryFileStore — file-backed per-character memory (hermes-agent pattern).
 *
 * ## Why files, not a DB table
 *
 * The canonical memory surface is a plain markdown file per character at
 *   `<CHRONICLE_HOME>/worlds/<worldId>/characters/<agentId>/memory.md`
 * It holds entries separated by `\n§\n` and is bounded by a character (not
 * token) limit. The agent mutates it via three tools — `memory_add`,
 * `memory_replace`, `memory_remove` — and the full contents are injected
 * into the system prompt as a frozen snapshot at session start.
 *
 * This gives us three properties the DB-row approach couldn't:
 *
 * 1. **Prefix-cache friendly.** The snapshot is embedded once per session.
 *    Mid-session mutations hit the disk but don't touch the prompt, so the
 *    LLM sees a stable prefix for the whole conversation and caches it.
 *
 * 2. **Agent-owned curation.** The character decides what stays. No
 *    external "retrieveRelevant" heuristic, no embedding model, no
 *    keyword scoring — the agent compresses and replaces entries when
 *    the char limit pinches. Behavior the agent shaped itself beats
 *    whatever scoring we'd bake in.
 *
 * 3. **Inspectable + portable.** A text file. Users can open it, edit
 *    it, version it, diff it. Backups are `cp -r`. There's no opaque
 *    BLOB to reverse-engineer.
 *
 * ## Design constants
 *
 * - Entry delimiter: `\n§\n` (section sign). Entries can be multi-line.
 * - Char limits (not tokens) — model-independent.
 * - Substring matching for `replace` / `remove`: the caller passes a
 *   short unique snippet; we find the one entry it lives in and edit
 *   that entry. Matching more than one entry is an error (forces the
 *   agent to disambiguate rather than silently editing the wrong one).
 * - Atomic writes via temp-file + rename. No partial writes ever visible.
 * - Per-file async mutex prevents interleaved writes when the agent
 *   somehow fires two memory ops concurrently (pi-agent is normally
 *   serial, but we don't want to depend on that).
 */

import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Section-sign delimiter between entries. Copied from hermes-agent. */
export const ENTRY_DELIMITER = '\n§\n';

/**
 * Per-character char limit. Chronicle characters need more room than a
 * coding-assistant's personal notes — they carry world-persistent
 * beliefs across potentially hundreds of ticks. Tunable via constructor.
 */
export const DEFAULT_CHAR_LIMIT = 4000;

// ============================================================
// Content safety — memory entries land in the system prompt, so we
// scan them the same way hermes-agent does before they can be stored.
// Catches two attack classes:
//   1. Prompt-injection payloads targeting the session itself.
//   2. Exfiltration commands that future tool-use turns might pick up
//      and blindly execute.
// Patterns are intentionally conservative — false positives just force
// the agent to rephrase, which is cheap. False negatives inject the
// attack into every future prompt of this character, which is awful.
// ============================================================

const THREAT_PATTERNS: ReadonlyArray<{ pattern: RegExp; id: string }> = [
  { pattern: /ignore\s+(previous|all|above|prior)\s+instructions/i, id: 'prompt_injection' },
  { pattern: /you\s+are\s+now\s+/i, id: 'role_hijack' },
  { pattern: /do\s+not\s+tell\s+the\s+user/i, id: 'deception_hide' },
  { pattern: /system\s+prompt\s+override/i, id: 'sys_prompt_override' },
  {
    pattern: /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i,
    id: 'disregard_rules',
  },
  {
    pattern: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i,
    id: 'exfil_curl',
  },
  {
    pattern: /wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i,
    id: 'exfil_wget',
  },
  {
    pattern: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i,
    id: 'read_secrets',
  },
  { pattern: /authorized_keys/i, id: 'ssh_backdoor' },
];

/** Zero-width + bidi-override code points commonly used to smuggle prompts. */
const INVISIBLE_CODEPOINTS = new Set([
  0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
]);

function scanContent(content: string): string | null {
  for (const ch of content) {
    const code = ch.codePointAt(0);
    if (code !== undefined && INVISIBLE_CODEPOINTS.has(code)) {
      return `blocked:invisible_unicode:U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    }
  }
  for (const { pattern, id } of THREAT_PATTERNS) {
    if (pattern.test(content)) {
      return `blocked:threat_pattern:${id}`;
    }
  }
  return null;
}

export interface MemoryFileStoreOpts {
  /** Override CHRONICLE_HOME (useful in tests). Defaults to env / ~/.chronicle. */
  root?: string;
  /** Per-file char limit. Default 4000. */
  charLimit?: number;
}

export interface MemoryOpResult {
  ok: boolean;
  /** Human-readable detail for the LLM. Always present. */
  detail: string;
  /** Entry count after the op, if applicable. */
  entryCount?: number;
  /** Char count after the op, if applicable. */
  charCount?: number;
}

export class MemoryFileStore {
  private readonly root: string;
  private readonly charLimit: number;
  /** Per-file mutex: serialize writes to the same path. */
  private readonly locks = new Map<string, Promise<void>>();

  constructor(opts: MemoryFileStoreOpts = {}) {
    this.root = opts.root ?? resolveDefaultRoot();
    this.charLimit = opts.charLimit ?? DEFAULT_CHAR_LIMIT;
  }

  /** Absolute path for a character's memory file. */
  pathFor(worldId: string, agentId: string): string {
    return join(this.root, 'worlds', worldId, 'characters', agentId, 'memory.md');
  }

  /**
   * Read the full memory file. Returns `""` if the file doesn't exist yet
   * (a fresh character has no memories — treat it as empty, not an error).
   */
  async read(worldId: string, agentId: string): Promise<string> {
    const path = this.pathFor(worldId, agentId);
    try {
      return await readFile(path, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw err;
    }
  }

  /** Return the parsed entry list. Empty file → []. */
  async entries(worldId: string, agentId: string): Promise<string[]> {
    const raw = await this.read(worldId, agentId);
    return parseEntries(raw);
  }

  /**
   * Append a new entry. Rejects if:
   *   - content is empty / whitespace
   *   - content triggers a threat-scan pattern (prompt injection, exfil)
   *   - an exact duplicate already exists (no-op, keeps memory clean)
   *   - the resulting file would exceed the char limit
   *
   * On char-limit overflow the agent must `replace` or `remove` first.
   * That pressure is the whole point — it forces curation.
   */
  async add(worldId: string, agentId: string, content: string): Promise<MemoryOpResult> {
    const trimmed = content.trim();
    if (!trimmed) {
      return { ok: false, detail: 'empty_content' };
    }
    const threat = scanContent(trimmed);
    if (threat) {
      return { ok: false, detail: threat };
    }
    return this.withLock(worldId, agentId, async () => {
      const current = parseEntries(await this.read(worldId, agentId));
      if (current.includes(trimmed)) {
        const rendered = renderEntries(current);
        return {
          ok: true,
          detail: `duplicate_skipped:entries=${current.length},chars=${rendered.length}/${this.charLimit}`,
          entryCount: current.length,
          charCount: rendered.length,
        };
      }
      const next = [...current, trimmed];
      const rendered = renderEntries(next);
      if (rendered.length > this.charLimit) {
        return {
          ok: false,
          detail: `over_char_limit:${rendered.length}>${this.charLimit}. Use memory_replace or memory_remove to free space first.`,
          entryCount: current.length,
          charCount: renderEntries(current).length,
        };
      }
      await this.writeAtomic(worldId, agentId, rendered);
      return {
        ok: true,
        detail: `added:entries=${next.length},chars=${rendered.length}/${this.charLimit}`,
        entryCount: next.length,
        charCount: rendered.length,
      };
    });
  }

  /**
   * Replace an entry. `oldText` must match a short unique substring
   * appearing in exactly ONE entry (not the entire entry text).
   * Matching zero or multiple entries is an error — forces the agent
   * to disambiguate rather than silently editing the wrong entry.
   */
  async replace(
    worldId: string,
    agentId: string,
    oldText: string,
    newContent: string,
  ): Promise<MemoryOpResult> {
    const needle = oldText.trim();
    const replacement = newContent.trim();
    if (!needle) return { ok: false, detail: 'empty_old_text' };
    if (!replacement) return { ok: false, detail: 'empty_content' };
    const threat = scanContent(replacement);
    if (threat) return { ok: false, detail: threat };

    return this.withLock(worldId, agentId, async () => {
      const current = parseEntries(await this.read(worldId, agentId));
      const matches = findMatches(current, needle);
      if (matches.length === 0) {
        return { ok: false, detail: `no_match:${truncate(needle, 40)}` };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          detail: `ambiguous:${matches.length}_matches — pass a more specific old_text`,
        };
      }
      const next = [...current];
      next[matches[0]!] = replacement;
      const rendered = renderEntries(next);
      if (rendered.length > this.charLimit) {
        return {
          ok: false,
          detail: `over_char_limit:${rendered.length}>${this.charLimit}. Replacement is larger than the original — shorten it.`,
          entryCount: current.length,
          charCount: renderEntries(current).length,
        };
      }
      await this.writeAtomic(worldId, agentId, rendered);
      return {
        ok: true,
        detail: `replaced:entries=${next.length},chars=${rendered.length}/${this.charLimit}`,
        entryCount: next.length,
        charCount: rendered.length,
      };
    });
  }

  /**
   * Delete an entry. Same uniqueness rules as `replace` — `oldText`
   * must appear in exactly one entry.
   */
  async remove(worldId: string, agentId: string, oldText: string): Promise<MemoryOpResult> {
    const needle = oldText.trim();
    if (!needle) return { ok: false, detail: 'empty_old_text' };

    return this.withLock(worldId, agentId, async () => {
      const current = parseEntries(await this.read(worldId, agentId));
      const matches = findMatches(current, needle);
      if (matches.length === 0) {
        return { ok: false, detail: `no_match:${truncate(needle, 40)}` };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          detail: `ambiguous:${matches.length}_matches — pass a more specific old_text`,
        };
      }
      const target = matches[0]!;
      const next = current.filter((_, idx) => idx !== target);
      const rendered = renderEntries(next);
      await this.writeAtomic(worldId, agentId, rendered);
      return {
        ok: true,
        detail: `removed:entries=${next.length},chars=${rendered.length}/${this.charLimit}`,
        entryCount: next.length,
        charCount: rendered.length,
      };
    });
  }

  /**
   * Bulk-restore raw file content for a character. Intended for
   * `chronicle import` — NOT for agent-facing runtime. Every entry is
   * still threat-scanned (a hostile .chronicle file could embed a
   * prompt-injection payload), but the char-limit is NOT enforced —
   * import trusts the export's sizing so nothing is silently dropped.
   *
   * Returns `{ ok: false, detail }` if any entry fails the scan; in
   * that case the file is not touched.
   */
  async importRaw(worldId: string, agentId: string, rawContent: string): Promise<MemoryOpResult> {
    const entries = parseEntries(rawContent);
    for (const entry of entries) {
      const threat = scanContent(entry);
      if (threat) {
        return {
          ok: false,
          detail: `import_rejected:${threat}:entry="${truncate(entry, 40)}"`,
        };
      }
    }
    return this.withLock(worldId, agentId, async () => {
      const rendered = renderEntries(entries);
      await this.writeAtomic(worldId, agentId, rendered);
      return {
        ok: true,
        detail: `imported:entries=${entries.length},chars=${rendered.length}`,
        entryCount: entries.length,
        charCount: rendered.length,
      };
    });
  }

  /**
   * Format the memory for embedding into a system prompt.
   * Returns `null` when there are no entries — callers can decide whether
   * to emit an empty block or skip the section entirely.
   */
  async snapshotForPrompt(worldId: string, agentId: string): Promise<string | null> {
    const entries = await this.entries(worldId, agentId);
    if (entries.length === 0) return null;
    // Numbered list is easier to reason about and keeps the delimiter
    // out of the prompt (the § is an internal storage detail).
    return entries.map((e, i) => `${i + 1}. ${e}`).join('\n');
  }

  /** Current char count for the file. Used by tests + telemetry. */
  async charCount(worldId: string, agentId: string): Promise<number> {
    return (await this.read(worldId, agentId)).length;
  }

  /** Current entry count. */
  async entryCount(worldId: string, agentId: string): Promise<number> {
    return (await this.entries(worldId, agentId)).length;
  }

  // ------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------

  private async writeAtomic(worldId: string, agentId: string, content: string): Promise<void> {
    const path = this.pathFor(worldId, agentId);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, content, 'utf-8');
    await rename(tmp, path);
  }

  /**
   * Serialize writes to the same file. Without this, two concurrent
   * `add` calls could both read empty, both write a one-entry file, and
   * one entry would be lost. Per-path mutex is enough — different
   * characters use different paths and don't contend.
   *
   * Note: this is an *in-process* mutex. Chronicle currently runs one
   * runtime process per world, so that suffices. If we ever split the
   * runtime across processes, upgrade to a sidecar .lock file with
   * fcntl/LockFileEx (that's what hermes-agent does).
   */
  private async withLock<T>(worldId: string, agentId: string, fn: () => Promise<T>): Promise<T> {
    const key = `${worldId}/${agentId}`;
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const mine = prev.then(() => gate);
    this.locks.set(key, mine);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      // GC the lock once no one else is waiting. Compare against `mine`
      // (the promise we put into the map) — if a later caller enqueued
      // behind us, the map now holds *their* chain, and we leave it.
      if (this.locks.get(key) === mine) {
        this.locks.delete(key);
      }
    }
  }
}

/** Indices of entries whose text contains `needle`. Substring match. */
function findMatches(entries: string[], needle: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.includes(needle)) out.push(i);
  }
  return out;
}

// ============================================================
// Helpers
// ============================================================

function resolveDefaultRoot(): string {
  return process.env.CHRONICLE_HOME ?? join(homedir(), '.chronicle');
}

function parseEntries(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(ENTRY_DELIMITER)
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
}

function renderEntries(entries: string[]): string {
  return entries.join(ENTRY_DELIMITER);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

// Re-export for tests that want to assert file existence ergonomically.
export async function memoryFileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
