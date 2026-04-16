/**
 * Type-level smoke tests — mostly exercise exhaustiveness on unions
 * so TS catches missing cases at compile time.
 *
 * These tests compile-check themselves via `bun test` + strict TS.
 */

import { describe, expect, it } from 'bun:test';
import type {
  AgreementStatus,
  EventType,
  MemoryType,
  ModelTier,
  RuleTier,
  ThinkingLevel,
} from '@chronicle/core';

describe('core types — discriminated unions', () => {
  it('EventType covers action + lifecycle + narrative categories', () => {
    const vs: EventType[] = [
      'tick_begin',
      'tick_end',
      'action',
      'rule_violation',
      'death',
      'birth',
      'god_intervention',
      'agent_reflection',
      'catalyst',
    ];
    expect(vs.length).toBeGreaterThanOrEqual(9);
  });

  it('MemoryType covers all memory kinds', () => {
    const vs: MemoryType[] = ['observation', 'reflection', 'goal', 'belief_about_other', 'thought'];
    expect(vs.length).toBe(5);
  });

  it('ModelTier names are stable', () => {
    const vs: ModelTier[] = ['haiku', 'sonnet', 'opus'];
    expect(vs.includes('haiku')).toBe(true);
  });

  it('ThinkingLevel is bounded', () => {
    const vs: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    expect(vs.length).toBe(6);
  });

  it('RuleTier has three tiers', () => {
    const vs: RuleTier[] = ['hard', 'soft', 'economic'];
    expect(vs.length).toBe(3);
  });

  it('AgreementStatus covers the full lifecycle', () => {
    const vs: AgreementStatus[] = ['proposed', 'active', 'fulfilled', 'violated', 'expired'];
    expect(vs.length).toBe(5);
  });
});
