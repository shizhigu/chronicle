/**
 * Unit tests for @chronicle/core/redact.
 *
 * Each prefix pattern gets at least one test case. Prefixes must be
 * tested individually so a regression (accidentally loosening or
 * tightening a regex) fails CI before hitting production transports.
 */

import { describe, expect, it } from 'bun:test';
import { REDACTION_ENABLED, redact, redactValue } from '../src/redact.js';

describe('REDACTION_ENABLED', () => {
  it('defaults to true when the env var is unset', () => {
    // The import already happened under the test runner, which does
    // not set CHRONICLE_REDACT — so the constant captures "on."
    expect(REDACTION_ENABLED).toBe(true);
  });
});

describe('redact — prefix patterns', () => {
  it('masks OpenAI / Anthropic sk- keys with partial reveal', () => {
    const input = 'my key is sk-ant-abcdef012345xyz and also sk-proj-9876543210zxcv';
    const out = redact(input);
    expect(out).not.toContain('abcdef012345xyz');
    expect(out).toContain('sk-ant'); // prefix preserved
    expect(out).toMatch(/\*{6}/); // masked middle
  });

  it('masks GitHub tokens', () => {
    expect(redact('ghp_1234567890ABCDEFghijklmnop')).not.toContain('1234567890ABCDEFghijklmnop');
    expect(redact('gho_abcdef1234567890ABCDEF')).not.toContain('abcdef1234567890ABCDEF');
  });

  it('masks Slack xox tokens', () => {
    const out = redact('xoxb-1234567890-abcd-efgh');
    expect(out).not.toContain('1234567890-abcd-efgh');
    expect(out).toMatch(/xoxb-1/);
  });

  it('masks Google AIza keys', () => {
    const input = 'token AIzaSy1234567890abcdefghijklmnopqrstuvwxyzABC end';
    const out = redact(input);
    expect(out).not.toContain('AIzaSy1234567890abcdefghijklmnopqrstuvwxyzABC');
  });

  it('masks AWS access-key IDs (exactly AKIA + 16)', () => {
    expect(redact('AKIAIOSFODNN7EXAMPLE')).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('masks Stripe sk_live / sk_test / rk_live', () => {
    expect(redact('sk_live_1234567890abcdefABCDEF')).not.toContain('1234567890abcdefABCDEF');
    expect(redact('sk_test_zyxwvutsrqponmlk1234')).not.toContain('zyxwvutsrqponmlk1234');
    expect(redact('rk_live_restrictedkey123456')).not.toContain('restrictedkey123456');
  });

  it('masks SendGrid SG.xxx keys', () => {
    const out = redact('SG.abcdef12345-67890_ABCDEFXXYYZZ');
    expect(out).not.toContain('abcdef12345-67890_ABCDEFXXYYZZ');
  });

  it('masks HuggingFace hf_, Replicate r8_, npm_, pypi-, DigitalOcean dop/doo', () => {
    for (const raw of [
      'hf_abcdef12345678901234',
      'r8_abcdef12345678901234',
      'npm_abcdef12345678901234',
      'pypi-abcdef12345-67890ABCDEF',
      'dop_v1_abcdef12345678901234',
      'doo_v1_abcdef12345678901234',
    ]) {
      const out = redact(raw);
      expect(out).not.toBe(raw);
      expect(out).toMatch(/\*{6}/);
    }
  });

  it('masks Perplexity / Groq / Tavily / Exa / Firecrawl / Fal.ai', () => {
    for (const raw of [
      'pplx-abcdef12345678901234',
      'gsk_abcdef12345678901234',
      'tvly-abcdef12345678901234',
      'exa_abcdef12345678901234',
      'fc-abcdef12345678901234',
      'fal_abcdef12345-67890ABCDEF',
    ]) {
      const out = redact(raw);
      expect(out).not.toBe(raw);
    }
  });
});

describe('redact — contextual patterns', () => {
  it('masks Authorization: Bearer tokens', () => {
    const out = redact('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9-veryLongToken');
    expect(out).toMatch(/Authorization: Bearer /);
    expect(out).not.toContain('veryLongToken');
  });

  it('masks VAR=value env-style assignments for secret-looking names', () => {
    const out = redact('OPENAI_API_KEY=sk-ant-very-long-actual-value-12345678');
    expect(out).toContain('OPENAI_API_KEY=');
    expect(out).not.toContain('sk-ant-very-long-actual-value-12345678');
  });

  it('masks JSON-style "apiKey": "value"', () => {
    const out = redact('{"apiKey":"actual-token-1234567890"}');
    expect(out).toContain('"apiKey"');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('actual-token-1234567890');
  });

  it('fully masks short tokens (< 18 chars)', () => {
    // The `short_token` prefix part and body combine to under 18 chars.
    // Not a realistic token but tests the short-path.
    const input = 'sk-short1234567'; // sk- + 12 = 15 chars, below threshold
    const out = redact(input);
    expect(out).toBe('[REDACTED]');
  });

  it('keeps a 6-char prefix and 4-char suffix for long tokens', () => {
    const raw = 'sk-ant-aaaaaaaaaaaaaaaaaaxyz1';
    const out = redact(raw);
    expect(out.startsWith('sk-ant')).toBe(true);
    expect(out.endsWith('xyz1')).toBe(true);
    expect(out.length).toBeLessThan(raw.length);
  });
});

describe('redact — passthrough', () => {
  it('returns identical string when nothing matches', () => {
    const input = 'the quick brown fox says hello';
    expect(redact(input)).toBe(input);
  });

  it('handles empty / null-ish gracefully', () => {
    expect(redact('')).toBe('');
  });
});

describe('redactValue — deep structure', () => {
  it('redacts strings at every depth', () => {
    const input = {
      level: {
        list: ['benign', 'sk-ant-realkeywithenoughlength123'],
        inner: { token: 'ghp_realgithubtoken1234567890' },
      },
      persona: 'Alice carries an API key sk-proj-stillverylongenough2345',
    };
    const out = redactValue(input);

    // Structure unchanged.
    expect(out.level.list[0]).toBe('benign');
    // Redacted leaves.
    expect(out.level.list[1]).not.toContain('realkeywithenoughlength123');
    expect(out.level.inner.token).not.toContain('realgithubtoken1234567890');
    expect(out.persona).not.toContain('stillverylongenough2345');
  });

  it('passes through numbers / booleans / null unchanged', () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBeNull();
  });

  it('returns the same reference when nothing changes (no needless alloc)', () => {
    const input = { persona: 'the sky is blue', traits: { bold: 0.5 } };
    const out = redactValue(input);
    expect(out).toBe(input); // identity preserved
  });

  it('handles self-referential objects without stack overflow (cycle guard)', () => {
    // Real debug payloads (Express req, Zod errors) often contain
    // circular references. We must not recurse forever.
    const obj: Record<string, unknown> = { name: 'cyclic' };
    obj.self = obj;
    obj.token = 'sk-ant-supersecret1234567890xyz';

    // The call returns without throwing.
    const out = redactValue(obj) as Record<string, unknown>;
    expect(out.name).toBe('cyclic');
    expect(out.token).not.toContain('supersecret1234567890xyz');
  });
});

describe('redact — review fixes', () => {
  it('AKIA alone does NOT mask — must be full AKIA + 16 alphanumeric chars', () => {
    // Common non-key strings that embed AKIA shouldn't be redacted.
    expect(redact('the AKIA region')).toBe('the AKIA region');
    expect(redact('akia_custom_region_tag')).toBe('akia_custom_region_tag');
    // But a real access key id gets masked.
    expect(redact('AKIAIOSFODNN7EXAMPLE')).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('masks Cerebras csk- keys', () => {
    const out = redact('csk-abcdef12345678901234');
    expect(out).not.toContain('abcdef12345678901234');
  });

  it('masks Together AI together_ keys', () => {
    const out = redact('together_abcdef1234567890abcdef12');
    expect(out).not.toContain('abcdef1234567890abcdef12');
  });

  it('Cohere co- requires a long body, not just plain "co-authored"', () => {
    // A short "co-" prefix must not fire on common English fragments.
    expect(redact('Co-authored-By: Alice')).toBe('Co-authored-By: Alice');
    // A real-looking long key does fire.
    const realish = 'co-' + 'a'.repeat(35);
    const out = redact(realish);
    expect(out).not.toBe(realish);
  });
});
