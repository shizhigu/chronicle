/**
 * chronicle dashboard <worldId> [--port 7070] [--ws-port 7071]
 *
 * Starts the WebSocket bridge so the dashboard (run separately in dev, bundled
 * in prod) can receive live events from the running engine.
 *
 * v0.1: launches WebSocket bridge + engine loop. Prints dashboard URL.
 * v0.2: also spawns Remix server and opens browser.
 */

import { Engine, EventBus, RuleEnforcer, WebSocketBridge, WorldStore } from '@chronicle/engine';
import { AgentPool } from '@chronicle/runtime';
import { loadConfig } from '../config.js';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

interface Options {
  port?: string;
  wsPort?: string;
}

export async function dashboardCommand(worldId: string, opts: Options): Promise<void> {
  const port = opts.port ? Number.parseInt(opts.port, 10) : 7070;
  const wsPort = opts.wsPort ? Number.parseInt(opts.wsPort, 10) : 7071;
  const config = await loadConfig();

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

  const bridge = new WebSocketBridge(engine.bus, { port: wsPort });
  bridge.start();

  console.log(`✓ WebSocket bridge running at ws://localhost:${wsPort}`);
  console.log(`  Dashboard URL (run separately): http://localhost:${port}/c/${worldId}`);
  console.log('');
  console.log('  To start dashboard UI in dev mode:');
  console.log('    cd packages/dashboard && npm run dev');
  console.log('');
  console.log('  Engine is idle — start a run in another shell:');
  console.log(`    chronicle run ${worldId} --ticks 50 --live`);

  printNextSteps([
    `mention "Dashboard bridge running. Start a run in another shell to see live events."`,
    `suggest_call "chronicle run ${worldId} --ticks 50 --live"`,
    `mention "Stop with Ctrl-C"`,
  ]);

  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      bridge.stop();
      engine.shutdown().finally(() => resolve());
    });
  });
}
