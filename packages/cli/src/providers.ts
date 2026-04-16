/**
 * Provider detection — probes every pi-agent-supported provider to see which
 * ones the user has configured. Used by `chronicle onboard` to auto-select a
 * starting default without forcing a specific model.
 *
 * Chronicle does not privilege any one provider. Whatever the user has
 * available (local, cloud, or a mix) is equally valid; we just need to tell
 * them what we see and pick the first one as an initial default.
 */

export interface ProviderProbe {
  /** pi-agent provider id, e.g. "anthropic", "openai", "openrouter", "lmstudio". */
  id: string;
  /** Human label for CLI output. */
  label: string;
  /** What gated the detection: `env`, `server`, or `oauth`. */
  kind: 'env' | 'server' | 'oauth';
  /** True if the credential/server is present. */
  available: boolean;
  /** Suggested model id when this provider is picked (user can override). */
  suggestedModel?: string;
  /** Extra info for onboarding output (e.g. which env var was found). */
  note?: string;
}

/**
 * Probe all supported providers. Local server checks have a tight timeout so
 * this never blocks onboarding for more than ~1 second.
 */
export async function detectProviders(): Promise<ProviderProbe[]> {
  const results: ProviderProbe[] = [];

  // --- Local servers (probe with 1s timeout) ---
  const [lmStudio, ollama] = await Promise.all([probeLmStudio(), probeOllama()]);
  if (lmStudio.available) results.push(lmStudio);
  if (ollama.available) results.push(ollama);

  // --- Env-gated cloud providers (a single sync env-var check each) ---
  const envChecks: Array<Omit<ProviderProbe, 'available'> & { envVar: string | string[] }> = [
    {
      id: 'anthropic',
      label: 'Anthropic',
      kind: 'env',
      envVar: ['ANTHROPIC_API_KEY', 'ANTHROPIC_OAUTH_TOKEN'],
    },
    { id: 'openai', label: 'OpenAI', kind: 'env', envVar: 'OPENAI_API_KEY' },
    {
      id: 'google',
      label: 'Google AI Studio',
      kind: 'env',
      envVar: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    },
    { id: 'openrouter', label: 'OpenRouter', kind: 'env', envVar: 'OPENROUTER_API_KEY' },
    { id: 'mistral', label: 'Mistral', kind: 'env', envVar: 'MISTRAL_API_KEY' },
    { id: 'groq', label: 'Groq', kind: 'env', envVar: 'GROQ_API_KEY' },
    {
      id: 'github-copilot',
      label: 'GitHub Copilot',
      kind: 'oauth',
      envVar: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
    },
    {
      id: 'vercel-ai-gateway',
      label: 'Vercel AI Gateway',
      kind: 'env',
      envVar: 'AI_GATEWAY_API_KEY',
    },
    {
      id: 'azure-openai-responses',
      label: 'Azure OpenAI',
      kind: 'env',
      envVar: 'AZURE_OPENAI_API_KEY',
    },
  ];

  for (const check of envChecks) {
    const vars = Array.isArray(check.envVar) ? check.envVar : [check.envVar];
    const found = vars.find((v) => !!process.env[v]);
    results.push({
      id: check.id,
      label: check.label,
      kind: check.kind,
      available: !!found,
      note: found ? `found ${found}` : `set ${vars.join(' or ')} to enable`,
    });
  }

  return results;
}

/**
 * List available providers. Chronicle does not auto-pick one — we just show
 * the user (or their agent) what's available and let them choose. Any
 * preference ordering here would be a brand bias we don't want to ship.
 */
export function availableProviders(probes: ProviderProbe[]): ProviderProbe[] {
  return probes.filter((p) => p.available);
}

// ============================================================
// Probes
// ============================================================

async function probeLmStudio(): Promise<ProviderProbe> {
  const baseUrl = process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1';
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) {
      return { id: 'lmstudio', label: 'LM Studio', kind: 'server', available: false };
    }
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    const firstModel = body.data?.[0]?.id;
    return {
      id: 'lmstudio',
      label: 'LM Studio',
      kind: 'server',
      available: true,
      suggestedModel: firstModel,
      note: firstModel ? `${baseUrl} · serving ${firstModel}` : `${baseUrl}`,
    };
  } catch {
    return {
      id: 'lmstudio',
      label: 'LM Studio',
      kind: 'server',
      available: false,
      note: `not reachable at ${baseUrl} — run \`lms server start\` if installed`,
    };
  }
}

async function probeOllama(): Promise<ProviderProbe> {
  const baseUrl = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) {
      return { id: 'ollama', label: 'Ollama', kind: 'server', available: false };
    }
    const body = (await res.json()) as { models?: Array<{ name: string }> };
    const firstModel = body.models?.[0]?.name;
    return {
      id: 'ollama',
      label: 'Ollama',
      kind: 'server',
      available: true,
      suggestedModel: firstModel,
      note: firstModel ? `${baseUrl} · serving ${firstModel}` : `${baseUrl}`,
    };
  } catch {
    return {
      id: 'ollama',
      label: 'Ollama',
      kind: 'server',
      available: false,
      note: `not reachable at ${baseUrl}`,
    };
  }
}
