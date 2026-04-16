/**
 * chronicle run <worldId> [--ticks N] [--live] [--budget $]
 *
 * Creates an Engine, runs the requested number of ticks, streams events if
 * --live. Persists on exit.
 */

import { Engine } from '@chronicle/engine';
import { AgentPool } from '@chronicle/runtime';
import { loadConfig } from '../config.js';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  ticks?: string;
  live?: boolean;
  speed?: string;
  budget?: string;
  untilEvent?: string;
}

export async function runCommand(worldId: string, opts: Options): Promise<void> {
  const ticks = opts.ticks ? Number.parseInt(opts.ticks, 10) : 50;
  const budget = opts.budget ? Number.parseFloat(opts.budget) * 1_000_000 : undefined; // USD → rough token cap
  const config = await loadConfig();

  // We need two things from engine: WorldStore (opened by Engine.init), and RuleEnforcer (too).
  // The runtime AgentPool needs those, but Engine owns them. We solve this by creating
  // the Engine first with an "uninitialized" runtime that gets hooked up on init.
  //
  // Simpler: open a shared WorldStore, build runtime with injected store/rule enforcer,
  // pass to Engine which reuses them.
  const { WorldStore, RuleEnforcer, EventBus } = await import('@chronicle/engine');
  const store = await WorldStore.open(paths.db);
  const world = await store.loadWorld(worldId);

  const events = new EventBus();
  const ruleEnforcer = new RuleEnforcer(store, world);
  const runtime = new AgentPool({ store, ruleEnforcer, events });

  const engine = new Engine({
    dbPath: paths.db,
    worldId,
    runtime,
    sonnetModel: { provider: config.sonnetProvider, modelId: config.sonnetModel },
  });
  await engine.init();

  // Subscribe for --live output
  if (opts.live) {
    engine.bus.subscribe((event) => {
      switch (event.type) {
        case 'tick_begin':
          process.stdout.write(`\n[tick ${event.tick}] `);
          break;
        case 'tick_end':
          process.stdout.write(`drama=${event.dramaScore.toFixed(2)} live=${event.liveAgentCount}`);
          break;
        case 'action_completed':
          process.stdout.write(
            ` ${event.agentId.slice(-4)}:${event.tool}${event.isError ? '✗' : '·'}`,
          );
          break;
        case 'god_intervention_applied':
          process.stdout.write(`\n  [GOD] ${event.description}\n`);
          break;
      }
    });
  }

  const startTick = engine.worldState.currentTick;
  try {
    await engine.run({ ticks, budget, untilEvent: opts.untilEvent });
  } finally {
    await engine.shutdown();
  }

  const endTick = engine.worldState.currentTick;
  console.log('');
  console.log(`\n✓ Ran ${endTick - startTick} ticks. World now at tick ${endTick}.`);

  printNextSteps([
    `show_user "Run complete at tick ${endTick}."`,
    `suggest_call "chronicle run ${worldId} --ticks 50 --live" (continue)`,
    `suggest_call "chronicle intervene ${worldId} --event '...'"`,
    `suggest_call "chronicle export ${worldId} --out ${worldId}.chronicle"`,
  ]);
}
