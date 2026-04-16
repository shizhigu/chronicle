/**
 * chronicle create-world --desc "..."
 */

import { WorldCompiler } from '@chronicle/compiler';
import { WorldStore } from '@chronicle/engine';
import { loadConfig } from '../config.js';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  desc: string;
  name?: string;
  model?: string;
  provider?: string;
}

export async function createWorldCommand(opts: Options): Promise<void> {
  const config = await loadConfig();
  const provider = opts.provider ?? config.defaultProvider;
  const model = opts.model ?? config.defaultModel;

  const store = await WorldStore.open(paths.db);

  console.log('✓ Parsing your description with AI...');
  const compiler = new WorldCompiler({
    provider: config.sonnetProvider,
    modelId: config.sonnetModel,
  });

  const compiled = await compiler.parseDescription(opts.desc);

  console.log('');
  console.log('✓ Generated world scaffold:');
  console.log('');
  console.log(`  Name: ${compiled.name}`);
  console.log(`  Setting: ${compiled.atmosphere} (${compiled.atmosphereTag})`);
  console.log(
    `  Scale: ${compiled.characters.length} characters, ${compiled.locations.length} locations`,
  );
  console.log('');
  console.log('  Characters:');
  for (const [i, c] of compiled.characters.entries()) {
    console.log(`    ${i + 1}. ${c.name}${c.age ? ` (${c.age})` : ''} — ${c.shortDescription}`);
  }
  console.log('');
  if (compiled.rules.length) {
    console.log('  Rules (before compilation):');
    for (const r of compiled.rules) {
      console.log(`    - ${r}`);
    }
    console.log('');
  }

  console.log('  Compiling rules and persisting world...');
  const worldId = await compiler.persist(store, compiled, {
    description: opts.desc,
    defaultProvider: provider,
    defaultModelId: model,
  });

  const costEst = estimateCost(compiled.characters.length, 100, model);
  console.log('');
  console.log(`  Estimated cost for 100 ticks: ~$${costEst.toFixed(2)}`);
  console.log('');
  console.log(`World created: ${worldId}`);
  console.log(`Dashboard (when launched): http://localhost:7070/c/${worldId}`);

  printNextSteps([
    `show_user "World '${compiled.name}' created with ${compiled.characters.length} characters."`,
    `suggest_call "chronicle run ${worldId} --ticks 50 --live"`,
    `suggest_call "chronicle dashboard ${worldId}"`,
    `mention "You can intervene mid-run: chronicle intervene ${worldId} --event '...'"`,
  ]);

  store.close();
}

function estimateCost(agentCount: number, tickCount: number, modelId: string): number {
  const perCall = modelId.includes('haiku') ? 0.0008 : 0.015;
  return perCall * agentCount * tickCount + 0.5; // add cost for reflection + compilation
}
