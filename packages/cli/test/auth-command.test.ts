/**
 * Tests for the `chronicle auth` subcommand's helpers.
 *
 * The subcommand actions themselves do I/O (stdin, process.stdout,
 * auth-storage writes), so we exercise the behaviour that doesn't need
 * a TTY: fingerprint masking (critical — never leak key content), and
 * the underlying auth-storage integration via imported helpers.
 *
 * Full subprocess coverage of `chronicle auth set / list / delete` lives
 * in the cli-subprocess test; this file keeps the fast path tight.
 */

import { describe, expect, it } from 'bun:test';
import { fingerprint } from '../src/commands/auth.js';

describe('fingerprint', () => {
  it('shows only the last 4 chars for a realistic api key', () => {
    expect(fingerprint('sk-ant-abcdef1234567890xyz8f2a')).toBe('…8f2a');
    // Important sanity: the fingerprint must NOT contain the prefix
    // (it's the "recognise which key" signal, not a leak channel).
    expect(fingerprint('sk-ant-very-long-secret-12345')).not.toContain('sk-');
  });

  it('fully masks short strings (never a real key; defensive)', () => {
    expect(fingerprint('abc')).toBe('…');
    expect(fingerprint('')).toBe('…');
  });

  it('is deterministic for the same input', () => {
    const k = 'sk-proj-abcdef1234567890';
    expect(fingerprint(k)).toBe(fingerprint(k));
  });

  it('uniquely distinguishes keys that differ in the last 4 chars', () => {
    expect(fingerprint('sk-one-key-aaaa')).not.toBe(fingerprint('sk-one-key-bbbb'));
  });
});
