/**
 * Tests for `chronicle onboard` — focused on the next-step synthesizer.
 *
 * We don't spawn a subprocess; we import the builder directly and verify it
 * produces the right prose for each environment shape. This keeps tests fast
 * and deterministic without mocking fs.
 */

import { describe, expect, it } from 'bun:test';
import { buildNextSteps } from '../src/commands/onboard.js';

function env(overrides: Partial<Parameters<typeof buildNextSteps>[0]> = {}) {
  return {
    bunVersion: '1.1.40',
    bunOk: true,
    configDirExists: true,
    configFileExists: true,
    worldsDirExists: true,
    anthropicKey: true,
    openAiKey: false,
    googleKey: false,
    piAgentReachable: true,
    chronicleHome: '/home/test/.chronicle',
    ...overrides,
  };
}

describe('buildNextSteps', () => {
  it('prompts for Bun install when missing', () => {
    const steps = buildNextSteps(env({ bunOk: false }));
    expect(steps.some((s) => s.toLowerCase().includes('install bun'))).toBe(true);
  });

  it('prompts for an LLM key when none are present', () => {
    const steps = buildNextSteps(env({ anthropicKey: false }));
    expect(steps.some((s) => s.includes('ANTHROPIC_API_KEY'))).toBe(true);
  });

  it('does not prompt for keys if any provider is set', () => {
    const steps = buildNextSteps(env({ anthropicKey: false, openAiKey: true }));
    expect(steps.some((s) => s.includes('ANTHROPIC_API_KEY'))).toBe(false);
  });

  it('mentions config file when absent', () => {
    const steps = buildNextSteps(env({ configFileExists: false }));
    expect(steps.some((s) => s.includes('config file'))).toBe(true);
  });

  it('prompts to install pi-agent when missing', () => {
    const steps = buildNextSteps(env({ piAgentReachable: false }));
    expect(steps.some((s) => s.includes('pi-agent'))).toBe(true);
  });

  it('always teaches create-world and dashboard', () => {
    const steps = buildNextSteps(env());
    expect(steps.some((s) => s.includes('create-world'))).toBe(true);
    expect(steps.some((s) => s.includes('dashboard'))).toBe(true);
  });

  it('on a fully-configured environment, only teaches the happy path', () => {
    const steps = buildNextSteps(env());
    expect(steps.length).toBe(2);
    expect(steps[0]).toContain('create-world');
    expect(steps[1]).toContain('dashboard');
  });
});
