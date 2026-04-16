/**
 * Tests for the CLI's public exit-code contract.
 *
 * The numbers in this file are **public contract** — scripts and agents
 * rely on specific codes to branch on specific failure modes. These
 * tests exist to catch accidental renumbering during refactors.
 */

import { describe, expect, it } from 'bun:test';
import { CliError, ExitCode, classifyExitCode } from '../src/exit-codes.js';

describe('ExitCode contract', () => {
  it('has stable numeric values — scripts rely on these', () => {
    expect(ExitCode.Ok).toBe(0);
    expect(ExitCode.Generic).toBe(1);
    expect(ExitCode.ConfigError).toBe(2);
    expect(ExitCode.NoProvider).toBe(3);
    expect(ExitCode.NotFound).toBe(4);
    expect(ExitCode.BudgetExceeded).toBe(5);
    expect(ExitCode.AuthError).toBe(6);
  });

  it('all codes are distinct', () => {
    const values = Object.values(ExitCode);
    expect(new Set(values).size).toBe(values.length);
  });

  it("stays in 0-7 range so we don't collide with sysexits.h conventions", () => {
    for (const v of Object.values(ExitCode)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(8);
    }
  });
});

describe('CliError', () => {
  it('carries a code and exposes it', () => {
    const err = new CliError('config broke', ExitCode.ConfigError);
    expect(err.code).toBe(ExitCode.ConfigError);
    expect(err.message).toBe('config broke');
    expect(err.name).toBe('CliError');
  });

  it('optionally carries an action hint', () => {
    const err = new CliError('world missing', ExitCode.NotFound, 'Run chronicle list');
    expect(err.action).toBe('Run chronicle list');
  });

  it('is a real Error — instanceof / stack still work', () => {
    const err = new CliError('x', ExitCode.Generic);
    expect(err instanceof Error).toBe(true);
    expect(typeof err.stack).toBe('string');
  });
});

describe('classifyExitCode', () => {
  it("returns a CliError's declared code", () => {
    const err = new CliError('x', ExitCode.AuthError);
    expect(classifyExitCode(err)).toBe(ExitCode.AuthError);
  });

  it('returns Generic for plain Error', () => {
    expect(classifyExitCode(new Error('random'))).toBe(ExitCode.Generic);
  });

  it('returns Generic for non-Error throws', () => {
    expect(classifyExitCode('a string')).toBe(ExitCode.Generic);
    expect(classifyExitCode(42)).toBe(ExitCode.Generic);
    expect(classifyExitCode(null)).toBe(ExitCode.Generic);
    expect(classifyExitCode(undefined)).toBe(ExitCode.Generic);
  });
});
