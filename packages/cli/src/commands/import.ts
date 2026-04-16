/**
 * chronicle import <file.chronicle>
 *
 * Restores a world + its per-character memory files. For archives
 * produced before schemaVersion 2, the `memories` section is absent
 * and characters start with empty memory — which is fine, nothing is
 * ever *corrupted*, just not as rich.
 *
 * Every memory entry is threat-scanned during restore. A malicious
 * .chronicle file can embed prompt-injection payloads that would
 * otherwise land in a future session's system prompt, so we refuse
 * to write any character whose memory trips the scanner.
 */

import { readFile } from 'node:fs/promises';
import { MemoryFileStore, WorldStore } from '@chronicle/engine';
import { printNextSteps } from '../output.js';
import { paths } from '../paths.js';

export async function importCommand(file: string): Promise<void> {
  const raw = await readFile(file, 'utf-8');
  const bundle = JSON.parse(raw);

  const store = await WorldStore.open(paths.db);

  await store.createWorld(bundle.world);
  for (const loc of bundle.locations ?? []) await store.createLocation(loc);
  for (const a of bundle.agents ?? []) await store.createAgent(a);
  for (const r of bundle.rules ?? []) await store.createRule(r);
  for (const e of bundle.events ?? []) {
    await store.recordEvent({
      worldId: e.worldId,
      tick: e.tick,
      eventType: e.eventType,
      actorId: e.actorId,
      data: e.data,
      visibleTo: e.visibleTo,
      tokenCost: e.tokenCost,
    });
  }

  // Restore per-character memory files. Silently skipped for older
  // archives (schemaVersion 1) that predate the file-backed memory
  // cutover — those worlds simply resume with empty memory.
  const memories: Record<string, string> = bundle.memories ?? {};
  const worldIdForMemories: string = bundle.world.id;
  const memory = new MemoryFileStore();
  let memoryRestored = 0;
  const memoryRejected: Array<{ agentId: string; reason: string }> = [];
  for (const [agentId, content] of Object.entries(memories)) {
    if (!content) continue;
    const result = await memory.importRaw(worldIdForMemories, agentId, content);
    if (result.ok) {
      memoryRestored++;
    } else {
      memoryRejected.push({ agentId, reason: result.detail });
    }
  }

  console.log(`✓ Imported ${bundle.manifest?.worldName ?? 'world'} (${bundle.world.id})`);
  if (memoryRestored > 0 || memoryRejected.length > 0) {
    console.log(
      `  memory: ${memoryRestored} restored, ${memoryRejected.length} rejected (threat-scan)`,
    );
    for (const r of memoryRejected) {
      console.warn(`  ⚠ memory for ${r.agentId} skipped: ${r.reason}`);
    }
  }

  printNextSteps([
    `show_user "Imported. Run replay or fork to explore."`,
    `suggest_call "chronicle run ${bundle.world.id} --live"`,
  ]);
  store.close();
}
