import { describe, expect, it, mock } from 'bun:test';
import { type BusEvent, EventBus } from '../src/events/bus.js';

describe('EventBus', () => {
  it('delivers events to subscribers', () => {
    const bus = new EventBus();
    const received: BusEvent[] = [];
    bus.subscribe((e) => {
      received.push(e);
    });

    bus.emit({ type: 'tick_begin', worldId: 'w1', tick: 1 });
    bus.emit({ type: 'tick_end', worldId: 'w1', tick: 1, dramaScore: 0.5, liveAgentCount: 2 });

    expect(received.length).toBe(2);
    expect(received[0]?.type).toBe('tick_begin');
    expect(received[1]?.type).toBe('tick_end');
  });

  it('returns an unsubscribe function that removes the subscriber', () => {
    const bus = new EventBus();
    const received: BusEvent[] = [];
    const unsub = bus.subscribe((e) => {
      received.push(e);
    });

    bus.emit({ type: 'tick_begin', worldId: 'w1', tick: 1 });
    unsub();
    bus.emit({ type: 'tick_begin', worldId: 'w1', tick: 2 });

    expect(received.length).toBe(1);
    expect((received[0] as { tick: number }).tick).toBe(1);
  });

  it('isolates errors in one subscriber so others still receive', () => {
    const bus = new EventBus();
    const received: BusEvent[] = [];
    const originalError = console.error;
    console.error = mock(() => {});

    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((e) => {
      received.push(e);
    });

    bus.emit({ type: 'tick_begin', worldId: 'w1', tick: 1 });
    expect(received.length).toBe(1);

    console.error = originalError;
  });

  it('handles async subscribers that reject without killing fanout', async () => {
    const bus = new EventBus();
    const received: BusEvent[] = [];
    const originalError = console.error;
    console.error = mock(() => {});

    bus.subscribe(async () => {
      throw new Error('async boom');
    });
    bus.subscribe((e) => {
      received.push(e);
    });

    bus.emit({ type: 'tick_begin', worldId: 'w1', tick: 1 });

    await new Promise((r) => setTimeout(r, 10));
    expect(received.length).toBe(1);

    console.error = originalError;
  });

  it('clear() removes all subscribers', () => {
    const bus = new EventBus();
    const received: BusEvent[] = [];
    bus.subscribe((e) => {
      received.push(e);
    });
    bus.subscribe((e) => {
      received.push(e);
    });
    bus.clear();
    bus.emit({ type: 'tick_begin', worldId: 'w1', tick: 1 });
    expect(received.length).toBe(0);
  });

  it('supports many concurrent subscribers', () => {
    const bus = new EventBus();
    const counts = new Array(100).fill(0);
    for (let i = 0; i < 100; i++) {
      const idx = i;
      bus.subscribe(() => {
        counts[idx]!++;
      });
    }
    bus.emit({ type: 'tick_begin', worldId: 'w', tick: 0 });
    for (let i = 0; i < 100; i++) {
      expect(counts[i]).toBe(1);
    }
  });
});
