/**
 * `chronicle doctor` — diagnosis logic tests.
 *
 * We exercise buildDiagnosis directly with fixtures; the command-level
 * wiring is covered by the subprocess smoke test.
 */

import { describe, expect, it } from 'bun:test';
import { buildDiagnosis } from '../src/commands/doctor.js';
import type { ProviderProbe } from '../src/providers.js';

function probe(over: Partial<ProviderProbe> = {}): ProviderProbe {
  return {
    id: 'mock',
    label: 'Mock',
    kind: 'env',
    available: false,
    ...over,
  };
}

function state(over: Partial<Parameters<typeof buildDiagnosis>[0]> = {}) {
  return {
    bunVersion: '1.2.9',
    bunOk: true,
    chronicleHome: '/home/test/.chronicle',
    configFileExists: true,
    configParseable: true,
    configProvider: 'lmstudio',
    configModel: 'google/gemma-3-e4b',
    dbFilePath: '/home/test/.chronicle/worlds.db',
    dbExists: true,
    dbSizeMb: 1.2,
    ...over,
  };
}

describe('buildDiagnosis', () => {
  it('healthy environment returns only an "ok" finding', () => {
    const available = [probe({ id: 'lmstudio', kind: 'server', available: true })];
    const findings = buildDiagnosis(state(), available, available);
    expect(findings.length).toBe(1);
    expect(findings[0]?.level).toBe('ok');
  });

  it('flags unsupported Bun version as ERROR', () => {
    const findings = buildDiagnosis(state({ bunVersion: '1.0.0', bunOk: false }), [], []);
    expect(findings.some((f) => f.level === 'error' && /Bun/.test(f.message))).toBe(true);
  });

  it('flags missing config as WARN with action hint', () => {
    const findings = buildDiagnosis(
      state({ configFileExists: false, configParseable: false }),
      [],
      [],
    );
    const cfg = findings.find((f) => /No config/.test(f.message));
    expect(cfg?.level).toBe('warn');
    expect(cfg?.action).toContain('chronicle onboard');
  });

  it('flags unparseable config as ERROR', () => {
    const findings = buildDiagnosis(
      state({ configFileExists: true, configParseable: false }),
      [],
      [],
    );
    expect(findings.some((f) => f.level === 'error' && /unparseable/.test(f.message))).toBe(true);
  });

  it('flags no-available-provider as WARN', () => {
    const findings = buildDiagnosis(state(), [], []);
    expect(findings.some((f) => f.level === 'warn' && /provider available/i.test(f.message))).toBe(
      true,
    );
  });

  it('flags config provider missing from available list as WARN', () => {
    const findings = buildDiagnosis(
      state({ configProvider: 'anthropic', configModel: 'some-model' }),
      [probe({ id: 'lmstudio', kind: 'server', available: true })],
      [probe({ id: 'lmstudio', kind: 'server', available: true })],
    );
    expect(
      findings.some(
        (f) =>
          f.level === 'warn' &&
          /not currently available/.test(f.message) &&
          /anthropic/.test(f.message),
      ),
    ).toBe(true);
  });

  it('flags unset defaultProvider/defaultModel as WARN', () => {
    const findings = buildDiagnosis(
      state({ configProvider: null, configModel: null }),
      [probe({ id: 'lmstudio', kind: 'server', available: true })],
      [probe({ id: 'lmstudio', kind: 'server', available: true })],
    );
    expect(
      findings.some((f) => f.level === 'warn' && /defaultProvider\/defaultModel/.test(f.message)),
    ).toBe(true);
  });
});
