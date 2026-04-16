/**
 * Tests for the generic provider → pi-ai Model adapter in `llm.ts`.
 *
 * Unit-level: we exercise `shouldHandBuild` + `buildOpenAiCompatModel`
 * directly. Live integration (actually reaching a running server) is
 * covered separately by `test/integration/llm-live.test.ts` against LM
 * Studio.
 *
 * The goal of these tests is to guarantee that every OpenAI-compat
 * provider in `@chronicle/core`'s catalog — local servers, Chinese
 * clouds, inference hosts — gets a uniformly-shaped pi-ai model back
 * with the right `baseUrl`, and that Anthropic / Google / bare-OpenAI
 * fall through to pi-ai's native resolver.
 */

import { describe, expect, it } from 'bun:test';
import { BUILT_IN_PROVIDERS, type ProviderSpec, findProviderSpec } from '@chronicle/core';
import { buildOpenAiCompatModel, shouldHandBuild } from '../src/llm.js';

// ============================================================
// shouldHandBuild — routing decision
// ============================================================

describe('shouldHandBuild', () => {
  it('hand-builds for LM Studio (local server, default URL)', () => {
    const spec = findProviderSpec('lmstudio');
    expect(shouldHandBuild(spec, {})).toBe(true);
  });

  it('hand-builds for DeepSeek (Chinese cloud, baseUrlDefault)', () => {
    const spec = findProviderSpec('deepseek');
    expect(shouldHandBuild(spec, {})).toBe(true);
  });

  it('hand-builds for Zhipu/GLM — the user-asked-for case', () => {
    const spec = findProviderSpec('zai');
    expect(shouldHandBuild(spec, {})).toBe(true);
  });

  it('hand-builds for OpenRouter (aggregator with explicit default URL)', () => {
    const spec = findProviderSpec('openrouter');
    expect(shouldHandBuild(spec, {})).toBe(true);
  });

  it('falls through to pi-ai native for Anthropic (anthropic-messages transport)', () => {
    const spec = findProviderSpec('anthropic');
    expect(shouldHandBuild(spec, {})).toBe(false);
  });

  it('falls through to pi-ai native for Google AI Studio (google-generative transport)', () => {
    const spec = findProviderSpec('google');
    expect(shouldHandBuild(spec, {})).toBe(false);
  });

  it('falls through to pi-ai native for OpenAI (no baseUrlDefault — pi-ai knows the URL)', () => {
    // OpenAI has only `baseUrlEnvVar`, no default — so without an override
    // there's no resolvable URL for us to hand-build with, and pi-ai takes
    // over. If the user sets OPENAI_BASE_URL, we hand-build (see next test).
    const spec = findProviderSpec('openai');
    expect(shouldHandBuild(spec, {})).toBe(false);
  });

  it('hand-builds OpenAI when the user explicitly overrides OPENAI_BASE_URL', () => {
    // This is the "user has a self-hosted OpenAI-compatible proxy" case.
    const spec = findProviderSpec('openai');
    expect(shouldHandBuild(spec, { OPENAI_BASE_URL: 'https://my-proxy.test/v1' })).toBe(true);
  });

  it('returns false for unknown providers (pi-ai may still handle them)', () => {
    expect(shouldHandBuild(undefined, {})).toBe(false);
  });

  it('returns false for `codex-responses` transport (not openai-chat)', () => {
    const spec = findProviderSpec('codex');
    expect(shouldHandBuild(spec, {})).toBe(false);
  });
});

// ============================================================
// buildOpenAiCompatModel — model construction
// ============================================================

describe('buildOpenAiCompatModel', () => {
  const deepseek = findProviderSpec('deepseek') as ProviderSpec;
  const lmstudio = findProviderSpec('lmstudio') as ProviderSpec;

  it('sets api=openai-completions regardless of vendor identity', () => {
    const m = buildOpenAiCompatModel(deepseek, 'deepseek-chat', {});
    expect(m.api).toBe('openai-completions');
    expect(m.provider).toBe('openai'); // pi-ai routing, not vendor branding
  });

  it('uses the catalog default base URL when no env override', () => {
    const m = buildOpenAiCompatModel(deepseek, 'deepseek-chat', {});
    expect(m.baseUrl).toBe('https://api.deepseek.com/v1');
  });

  it('respects the per-provider base-URL env var override', () => {
    const m = buildOpenAiCompatModel(deepseek, 'deepseek-chat', {
      DEEPSEEK_BASE_URL: 'https://my-proxy.test/v1',
    });
    expect(m.baseUrl).toBe('https://my-proxy.test/v1');
  });

  it('flips Zhipu between global and China endpoints via GLM_BASE_URL', () => {
    const zai = findProviderSpec('zai') as ProviderSpec;
    const global = buildOpenAiCompatModel(zai, 'glm-4', {});
    expect(global.baseUrl).toBe('https://api.z.ai/api/paas/v4');

    const china = buildOpenAiCompatModel(zai, 'glm-4', {
      GLM_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4',
    });
    expect(china.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
  });

  it('sets compat flags that local + Chinese servers widely require', () => {
    const m = buildOpenAiCompatModel(lmstudio, 'google/gemma-3-e4b', {});
    expect(m.compat.supportsDeveloperRole).toBe(false);
    expect(m.compat.supportsReasoningEffort).toBe(false);
    expect(m.compat.supportsUsageInStreaming).toBe(false);
    expect(m.compat.maxTokensField).toBe('max_tokens');
  });

  it('throws a clear error when no base URL can be resolved', () => {
    // Hypothetical spec with neither default nor override.
    const broken: ProviderSpec = {
      id: 'custom',
      label: 'Custom (no URL)',
      transport: 'openai-chat',
      authType: 'api-key',
      apiKeyEnvVars: ['CUSTOM_API_KEY'],
      probe: 'env',
    };
    expect(() => buildOpenAiCompatModel(broken, 'foo', {})).toThrow(/no resolvable base URL/);
  });
});

// ============================================================
// Catalog coverage — every openai-chat provider with a default URL
// must be routable through the hand-built path.
// ============================================================

describe('catalog × llm.ts integration', () => {
  it('every openai-chat provider with a baseUrlDefault hand-builds cleanly', () => {
    const eligible = BUILT_IN_PROVIDERS.filter(
      (p) => p.transport === 'openai-chat' && typeof p.baseUrlDefault === 'string',
    );
    // Sanity: we expect at least a dozen such providers after the Chinese
    // clouds + inference hosts + local servers were added.
    expect(eligible.length).toBeGreaterThan(10);

    for (const spec of eligible) {
      const model = buildOpenAiCompatModel(spec, 'probe-model', {});
      expect(
        model.baseUrl,
        `provider '${spec.id}' did not produce a base URL in hand-built model`,
      ).toBe(spec.baseUrlDefault);
      expect(model.api).toBe('openai-completions');
    }
  });

  it('no anthropic-messages / google-generative / codex-responses provider is accidentally routed through the openai-compat path', () => {
    for (const spec of BUILT_IN_PROVIDERS) {
      if (spec.transport === 'openai-chat') continue;
      expect(
        shouldHandBuild(spec, {}),
        `provider '${spec.id}' with transport '${spec.transport}' must not hand-build`,
      ).toBe(false);
    }
  });
});
