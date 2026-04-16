/**
 * Tests for the top-level error summariser.
 *
 * The point of `summariseError` is to keep the first line the user sees
 * short and actionable — no raw Zod dumps, no anonymous `[object Object]`,
 * no surprise `undefined`. These tests lock that promise in.
 */

import { describe, expect, it } from 'bun:test';
import { summariseError } from '../src/errors.js';

describe('summariseError', () => {
  it('passes plain Error messages through unchanged', () => {
    expect(summariseError(new Error('boom'))).toBe('boom');
  });

  it('handles null/undefined without exploding', () => {
    expect(summariseError(null)).toBe('Unknown error');
    expect(summariseError(undefined)).toBe('Unknown error');
  });

  it('stringifies non-Error throws', () => {
    expect(summariseError('a string')).toBe('a string');
    expect(summariseError(42)).toBe('42');
  });

  it('summarises a ZodError-shaped value as prose instead of dumping the JSON', () => {
    const fake = {
      name: 'ZodError',
      issues: [
        { path: ['rules', 0, 'scope'], message: 'Expected object, received string' },
        { path: ['rules', 0, 'check'], message: 'Required' },
      ],
    };
    const out = summariseError(fake);
    expect(out).toContain('Schema validation failed');
    expect(out).toContain('rules.0.scope: Expected object, received string');
    expect(out).toContain('rules.0.check: Required');
    // Hint about retrying is useful on small-model setups
    expect(out).toMatch(/retrying/i);
  });

  it('truncates after 3 Zod issues with a "+N more" suffix', () => {
    const fake = {
      name: 'ZodError',
      issues: Array.from({ length: 7 }, (_, i) => ({
        path: ['x', i],
        message: `issue ${i}`,
      })),
    };
    const out = summariseError(fake);
    expect(out).toContain('+4 more');
    expect(out).toContain('x.0: issue 0');
    expect(out).toContain('x.2: issue 2');
    expect(out).not.toContain('x.3: issue 3'); // beyond the first 3
  });

  it('uses <root> when a Zod issue has no path', () => {
    const fake = {
      name: 'ZodError',
      issues: [{ path: [], message: 'whole object is the wrong shape' }],
    };
    expect(summariseError(fake)).toContain('<root>: whole object is the wrong shape');
  });
});
