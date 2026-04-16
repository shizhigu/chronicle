/**
 * chronicle config [--set key=value]
 */

import { loadConfig, setConfigValue } from '../config.js';
import { printNextSteps } from '../output.js';

interface Options {
  set?: string;
}

export async function configCommand(opts: Options): Promise<void> {
  if (opts.set) {
    const idx = opts.set.indexOf('=');
    if (idx < 0) {
      console.error('Invalid --set format. Use: --set key=value');
      process.exit(1);
    }
    const key = opts.set.slice(0, idx);
    const value = opts.set.slice(idx + 1);
    await setConfigValue(key, value);
    console.log(`✓ Set ${key}`);
    return;
  }

  const cfg = await loadConfig();
  // Redact API keys in output
  const redacted = JSON.parse(JSON.stringify(cfg));
  for (const p of Object.keys(redacted.providers ?? {})) {
    if (redacted.providers[p]?.apiKey) {
      redacted.providers[p].apiKey = '***';
    }
  }
  console.log(JSON.stringify(redacted, null, 2));

  printNextSteps([
    `mention "Set API key: chronicle config --set providers.anthropic.apiKey=sk-ant-..."`,
    `mention "Set default model: chronicle config --set defaultModel=claude-haiku-4-5"`,
  ]);
}
