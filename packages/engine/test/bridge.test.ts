/**
 * WebSocketBridge integration test using real Bun.serve on an ephemeral port.
 *
 * The test subscribes a client via the `ws://` URL, emits events on the bus,
 * and asserts the client receives them. Uses `0` as port to let the OS pick
 * — but the current bridge reads the configured port synchronously, so we
 * just pick a high-numbered test port.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { WebSocketBridge } from '../src/bridge/websocket.js';
import { EventBus } from '../src/events/bus.js';

const TEST_PORT = 38721; // unlikely to conflict locally

let bus: EventBus;
let bridge: WebSocketBridge;

beforeEach(() => {
  bus = new EventBus();
  bridge = new WebSocketBridge(bus, { port: TEST_PORT });
  bridge.start();
});

afterEach(() => {
  bridge.stop();
});

async function connect(worldId: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${TEST_PORT}/api/ws/${worldId}`);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(e));
  });
  return ws;
}

describe('WebSocketBridge', () => {
  it('rejects connection at a bad path', async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/not-api`);
    await new Promise<void>((resolve) => {
      ws.addEventListener('close', () => resolve());
      ws.addEventListener('error', () => resolve());
    });
    // either close or error — both mean it didn't upgrade
    expect(ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING).toBe(true);
  });

  it('delivers bus events for the matching worldId', async () => {
    const ws = await connect('w_alpha');
    const received: unknown[] = [];
    ws.addEventListener('message', (m) => received.push(JSON.parse(String(m.data))));

    // Give the server a tick to register the client
    await new Promise((r) => setTimeout(r, 30));

    bus.emit({ type: 'tick_begin', worldId: 'w_alpha', tick: 1 });
    bus.emit({ type: 'tick_end', worldId: 'w_alpha', tick: 1, dramaScore: 0.4, liveAgentCount: 2 });

    await new Promise((r) => setTimeout(r, 50));

    expect(received.length).toBe(2);
    expect((received[0] as { type: string }).type).toBe('tick_begin');
    ws.close();
  });

  it('does not leak events across different worlds', async () => {
    const a = await connect('w_a');
    const b = await connect('w_b');
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    a.addEventListener('message', (m) => receivedA.push(JSON.parse(String(m.data))));
    b.addEventListener('message', (m) => receivedB.push(JSON.parse(String(m.data))));

    await new Promise((r) => setTimeout(r, 30));

    bus.emit({ type: 'tick_begin', worldId: 'w_a', tick: 1 });
    bus.emit({ type: 'tick_begin', worldId: 'w_b', tick: 2 });

    await new Promise((r) => setTimeout(r, 50));

    expect(receivedA.length).toBe(1);
    expect(receivedB.length).toBe(1);
    expect((receivedA[0] as { tick: number }).tick).toBe(1);
    expect((receivedB[0] as { tick: number }).tick).toBe(2);

    a.close();
    b.close();
  });

  it('clientCount tracks connections', async () => {
    expect(bridge.clientCount('w_x')).toBe(0);
    const ws = await connect('w_x');
    await new Promise((r) => setTimeout(r, 30));
    expect(bridge.clientCount('w_x')).toBe(1);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(bridge.clientCount('w_x')).toBe(0);
  });

  it('ignores events with no worldId', async () => {
    const ws = await connect('w_any');
    const received: unknown[] = [];
    ws.addEventListener('message', (m) => received.push(JSON.parse(String(m.data))));
    await new Promise((r) => setTimeout(r, 30));

    // emit something without a worldId — TypeScript wouldn't allow this but
    // the runtime should handle it defensively
    bus.emit({ type: 'budget_exceeded' } as never);

    await new Promise((r) => setTimeout(r, 40));
    expect(received.length).toBe(0);
    ws.close();
  });
});
