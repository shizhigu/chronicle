/**
 * Tests for `chronicle onboard`'s next-step synthesizer.
 *
 * We exercise buildNextSteps directly (no subprocess), with fixture provider
 * probes. Chronicle is deliberately provider-agnostic; these tests lock that
 * in — any brand-favoring wording in the output would fail here.
 */

import { describe, expect, it } from 'bun:test';
import { buildNextSteps } from '../src/commands/onboard.js';
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

function state(over: Partial<Parameters<typeof buildNextSteps>[0]> = {}) {
  const probes = over.probes ?? [];
  const available = over.available ?? probes.filter((p) => p.available);
  return {
    bunVersion: '1.1.40',
    bunOk: true,
    configDirExists: true,
    configFileExists: true,
    worldsDirExists: true,
    piAgentReachable: true,
    chronicleHome: '/home/test/.chronicle',
    probes,
    available,
    ...over,
  };
}

describe('buildNextSteps', () => {
  it('prompts for Bun install when missing', () => {
    const steps = buildNextSteps(state({ bunOk: false }));
    expect(steps.some((s) => s.toLowerCase().includes('install bun'))).toBe(true);
  });

  it('when nothing is available, lists BOTH local and cloud options equally', () => {
    const steps = buildNextSteps(state({ probes: [] }));
    const text = steps.join('\n');
    expect(text).toContain('LM Studio');
    expect(text).toContain('Ollama');
    expect(text).toContain('ANTHROPIC_API_KEY');
    expect(text).toContain('OPENAI_API_KEY');
    expect(text).toContain('OPENROUTER_API_KEY');
    expect(text).toContain('GEMINI_API_KEY');
    expect(text).toContain('MISTRAL_API_KEY');
  });

  it('when providers ARE available, lists them WITHOUT picking one', () => {
    const lmstudio = probe({
      id: 'lmstudio',
      label: 'LM Studio',
      kind: 'server',
      available: true,
      suggestedModel: 'google/gemma-3-e4b',
    });
    const anthropic = probe({
      id: 'anthropic',
      label: 'Anthropic',
      kind: 'env',
      available: true,
    });
    const steps = buildNextSteps(state({ probes: [lmstudio, anthropic] }));
    const text = steps.join('\n');
    // Both appear
    expect(text).toContain('lmstudio');
    expect(text).toContain('anthropic');
    // We don't frame either as "picked" or "the starting default"
    expect(text).not.toMatch(/Chronicle picked|starting default/i);
    // And we don't lecture the user about switching between them
    expect(text).not.toMatch(/cheapest|we recommend/i);
  });

  it('lists local and cloud in the same "available" block — neither is privileged', () => {
    const lmstudio = probe({ id: 'lmstudio', kind: 'server', available: true });
    const openrouter = probe({ id: 'openrouter', kind: 'env', available: true });
    const steps = buildNextSteps(state({ probes: [lmstudio, openrouter] }));
    const text = steps.join('\n');
    expect(text).toContain('lmstudio');
    expect(text).toContain('openrouter');
    expect(text).toMatch(/pick one.*equally/i);
  });

  it('prompts to install pi-agent when missing', () => {
    const p = probe({ id: 'lmstudio', kind: 'server', available: true });
    const steps = buildNextSteps(state({ piAgentReachable: false, probes: [p] }));
    expect(steps.some((s) => s.includes('pi-agent'))).toBe(true);
  });

  it('always teaches create-world and dashboard', () => {
    const p = probe({ id: 'lmstudio', kind: 'server', available: true });
    const steps = buildNextSteps(state({ probes: [p] }));
    expect(steps.some((s) => s.includes('create-world'))).toBe(true);
    expect(steps.some((s) => s.includes('dashboard'))).toBe(true);
  });
});
