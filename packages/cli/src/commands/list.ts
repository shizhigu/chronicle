/**
 * chronicle list
 */

import { WorldStore } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

export async function listCommand(): Promise<void> {
  const store = await WorldStore.open(paths.db);
  const worlds = await store.listWorlds();
  if (worlds.length === 0) {
    console.log('No chronicles yet on this machine.');
    printNextSteps([`suggest_call "chronicle create-world --desc '<describe a scenario>'"`]);
    store.close();
    return;
  }

  console.log('Your chronicles:');
  console.log('');
  for (const w of worlds) {
    console.log(
      `  ${w.id}  [${w.status.padEnd(7)}]  tick ${w.currentTick.toString().padStart(4)}  ${w.name}`,
    );
  }
  console.log('');

  printNextSteps([
    `suggest_call "chronicle run <id> --ticks 50 --live"`,
    `suggest_call "chronicle dashboard <id>"`,
    `suggest_call "chronicle create-world --desc '...'"`,
  ]);
  store.close();
}
