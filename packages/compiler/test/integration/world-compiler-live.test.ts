/**
 * WorldCompiler live test — real call against local LM Studio.
 *
 * One LLM call per run, ~2500-token cap. Validates the entire
 * natural-language → CompiledWorld loop end-to-end.
 *
 * Gated: auto-skips if LM Studio's local server isn't reachable.
 */

import { describe, expect, it } from 'bun:test';
import { WorldCompiler } from '../../src/world-compiler.js';
import { lmStudioReady, resolveLmStudioModel } from './lmstudio-helper.js';

const READY = await lmStudioReady();
const MODEL = resolveLmStudioModel();

describe.skipIf(!READY)('WorldCompiler live · LM Studio', () => {
  it('parses a minimal scenario description into a valid CompiledWorld', async () => {
    const compiler = new WorldCompiler({ provider: 'lmstudio', modelId: MODEL });
    const compiled = await compiler.parseDescription(
      'A tense job interview. A candidate (nervous, hiding a past mistake) ' +
        'meets a hiring manager (sharp, under pressure from the CEO). ' +
        'Setting: an interview room and an adjoining hallway. ' +
        'Rule: only one person speaks at a time. Rule: lying has consequences.',
    );

    expect(compiled.name.length).toBeGreaterThan(0);
    expect(compiled.atmosphereTag.length).toBeGreaterThan(0);
    expect(['small', 'medium', 'large']).toContain(compiled.scale);
    expect(compiled.sharedSystemPrompt.length).toBeGreaterThan(10);
    expect(compiled.initialScene.length).toBeGreaterThan(10);

    expect(compiled.characters.length).toBeGreaterThanOrEqual(2);
    expect(compiled.characters.length).toBeLessThanOrEqual(50);
    for (const c of compiled.characters) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.persona.length).toBeGreaterThan(0);
      expect(c.startingLocationName.length).toBeGreaterThan(0);
    }

    expect(compiled.locations.length).toBeGreaterThanOrEqual(1);

    // Every character's starting location must reference a real location
    const locNames = new Set(compiled.locations.map((l) => l.name));
    for (const c of compiled.characters) {
      expect(locNames.has(c.startingLocationName)).toBe(true);
    }

    if (compiled.rules.length > 0) {
      for (const r of compiled.rules) {
        expect(typeof r).toBe('string');
        expect(r.length).toBeGreaterThan(0);
      }
    }
  }, 120_000); // local CPU can be slow
});
