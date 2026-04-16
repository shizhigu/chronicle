/**
 * CLI subprocess smoke — actually spawn the CLI binary and check it.
 *
 * This is the "does the built binary turn on" test. If this fails, no
 * amount of unit testing matters.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI_ENTRY = join(import.meta.dir, '..', 'src', 'index.ts');
const TMP_HOME = mkdtempSync(join(tmpdir(), 'chronicle-sub-'));

async function runCli(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(['bun', 'run', CLI_ENTRY, ...args], {
    env: {
      ...process.env,
      CHRONICLE_HOME: TMP_HOME,
      // Clear keys so onboard reports them missing
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      GOOGLE_API_KEY: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { stdout, stderr, exitCode };
}

describe('chronicle CLI — subprocess smoke', () => {
  beforeAll(() => {
    // sanity
    expect(CLI_ENTRY).toMatch(/\/src\/index\.ts$/);
  });
  afterAll(() => {
    rmSync(TMP_HOME, { recursive: true, force: true });
  });

  it('--version prints the version and exits 0', async () => {
    const { stdout, exitCode } = await runCli(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('--help lists commands', async () => {
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('create-world');
    expect(stdout).toContain('onboard');
    expect(stdout).toContain('dashboard');
  });

  it('onboard --json emits structured state + nextSteps', async () => {
    const { stdout, exitCode } = await runCli(['onboard', '--json']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.state).toBeTruthy();
    expect(parsed.state.bunOk).toBe(true);
    expect(parsed.state.chronicleHome).toBe(TMP_HOME);
    expect(Array.isArray(parsed.nextSteps)).toBe(true);
    // Without any keys set, onboarding should tell us to export one
    expect(parsed.nextSteps.join('\n')).toContain('ANTHROPIC_API_KEY');
  });

  it('onboard without --json prints human-readable with NEXT_STEPS block', async () => {
    const { stdout, exitCode } = await runCli(['onboard']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('CHRONICLE');
    expect(stdout).toContain('NEXT_STEPS');
    expect(stdout).toContain('END_NEXT_STEPS');
  });

  it('bare invocation falls through to interactive welcome', async () => {
    // commander sets `init` as the default command, so `chronicle` alone
    // shows the welcome screen. This is intentional — the CLI should feel
    // friendly when invoked with no args.
    const { stdout, exitCode } = await runCli([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Chronicle');
    expect(stdout).toContain('NEXT_STEPS');
  });
});
