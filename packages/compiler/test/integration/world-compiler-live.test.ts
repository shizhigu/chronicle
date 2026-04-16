/**
 * WorldCompiler live test — real DeepSeek-v3.2 via OpenRouter.
 *
 * One world-compile call per run, ~2500-token cap. This verifies the entire
 * natural-language-to-CompiledWorld loop end-to-end, using the same prompt
 * format a real user would invoke.
 *
 * Cost: ~$0.001 per run. Gated by OPENROUTER_API_KEY.
 */

import { describe, expect, it } from 'bun:test';
import { WorldCompiler } from '../../src/world-compiler.js';

const HAS_KEY = !!process.env.OPENROUTER_API_KEY;
const PROVIDER = 'openrouter';
const MODEL = 'deepseek/deepseek-v3.2';

describe.skipIf(!HAS_KEY)('WorldCompiler live · DeepSeek v3.2', () => {
  it('parses a minimal scenario description into a valid CompiledWorld', async () => {
    const compiler = new WorldCompiler({ provider: PROVIDER, modelId: MODEL });
    const compiled = await compiler.parseDescription(
      // Keep small: 2-4 characters, 2 locations, 2-3 rules.
      'A tense job interview. A candidate (nervous, hiding a past mistake) ' +
        'meets a hiring manager (sharp, under pressure from the CEO). ' +
        'Setting: an interview room and an adjoining hallway. ' +
        'Rule: only one person speaks at a time. Rule: lying has consequences.',
    );

    // Top-level invariants
    expect(compiled.name.length).toBeGreaterThan(0);
    expect(compiled.atmosphereTag.length).toBeGreaterThan(0);
    expect(['small', 'medium', 'large']).toContain(compiled.scale);
    expect(compiled.sharedSystemPrompt.length).toBeGreaterThan(10);
    expect(compiled.initialScene.length).toBeGreaterThan(10);

    // Characters — respect 2..50 range
    expect(compiled.characters.length).toBeGreaterThanOrEqual(2);
    expect(compiled.characters.length).toBeLessThanOrEqual(50);
    for (const c of compiled.characters) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.persona.length).toBeGreaterThan(0);
      expect(c.startingLocationName.length).toBeGreaterThan(0);
    }

    // Locations — at least one
    expect(compiled.locations.length).toBeGreaterThanOrEqual(1);

    // Every character's starting location must reference a real location
    const locNames = new Set(compiled.locations.map((l) => l.name));
    for (const c of compiled.characters) {
      expect(locNames.has(c.startingLocationName)).toBe(true);
    }

    // Rules — natural language strings
    if (compiled.rules.length > 0) {
      for (const r of compiled.rules) {
        expect(typeof r).toBe('string');
        expect(r.length).toBeGreaterThan(0);
      }
    }
  }, 60_000); // 60s timeout — real LLM call latency
});
