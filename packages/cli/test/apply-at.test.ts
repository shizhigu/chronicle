/**
 * `resolveApplyAt` — shared --at parser used by every CC-facing
 * intervention command. Must reject NaN / negative / past-tick
 * inputs that previously silently passed through as
 * `Number.parseInt(opts.at, 10)` and queued interventions for the
 * wrong tick (or tick NaN).
 */

import { describe, expect, it } from 'bun:test';
import { resolveApplyAt } from '../src/apply-at.js';
import { CliError } from '../src/exit-codes.js';

describe('resolveApplyAt', () => {
  it('defaults to currentTick + 1 when --at is absent', () => {
    expect(resolveApplyAt({}, 10)).toBe(11);
    expect(resolveApplyAt({ at: undefined }, 5)).toBe(6);
  });

  it('treats empty string / whitespace-only --at as "not provided"', () => {
    expect(resolveApplyAt({ at: '' }, 10)).toBe(11);
    expect(resolveApplyAt({ at: '   ' }, 10)).toBe(11);
  });

  it('accepts a future tick', () => {
    expect(resolveApplyAt({ at: '15' }, 10)).toBe(15);
    expect(resolveApplyAt({ at: '11' }, 10)).toBe(11);
  });

  it('rejects non-numeric --at with a CliError', () => {
    expect(() => resolveApplyAt({ at: 'foo' }, 10)).toThrow(CliError);
    expect(() => resolveApplyAt({ at: 'foo' }, 10)).toThrow(/must be an integer tick/);
  });

  it('rejects a past-tick --at', () => {
    expect(() => resolveApplyAt({ at: '5' }, 10)).toThrow(/must be > currentTick/);
    expect(() => resolveApplyAt({ at: '10' }, 10)).toThrow(/must be > currentTick/);
  });

  it('rejects negative / zero --at', () => {
    expect(() => resolveApplyAt({ at: '-5' }, 10)).toThrow(/must be > currentTick/);
    expect(() => resolveApplyAt({ at: '0' }, 10)).toThrow(/must be > currentTick/);
  });
});
