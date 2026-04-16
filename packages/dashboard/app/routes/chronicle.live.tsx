import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';

type Event =
  | { type: 'tick_begin'; tick: number }
  | { type: 'tick_end'; tick: number; dramaScore: number; liveAgentCount: number }
  | { type: 'action_completed'; agentId: string; tool: string; isError: boolean }
  | {
      type: 'speech';
      tick: number;
      fromAgentId: string;
      toTarget: string;
      content: string;
      tone: string | null;
    }
  | { type: 'god_intervention_applied'; tick: number; description: string }
  | { type: 'char_thinking'; agentId: string; delta: unknown };

export default function LiveView() {
  const { worldId } = useParams();
  const [events, setEvents] = useState<Event[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!worldId) return;
    const url = `ws://${window.location.hostname}:7071/api/ws/${worldId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as Event;
        setEvents((prev) => [...prev.slice(-100), ev]); // keep last 101
      } catch {
        // ignore malformed
      }
    };

    return () => ws.close();
  }, [worldId]);

  return (
    <div className="grid grid-cols-[1fr_320px] min-h-full">
      <div className="relative border-r border-cream/10">
        {/* Map canvas placeholder */}
        <div className="absolute inset-0 flex items-center justify-center text-cream/40">
          <MapCanvas events={events} />
        </div>
      </div>
      <aside className="p-4 text-sm overflow-auto">
        <h2 className="text-gold mb-2 text-xs uppercase tracking-wider">Event Stream</h2>
        <div className="text-xs text-cream/50 mb-3">
          {connected ? '● connected' : '○ disconnected'}
        </div>
        <ul className="space-y-1 font-mono text-[11px]">
          {events
            .slice(-40)
            .reverse()
            .map((ev, i) => (
              <li key={events.length - i} className="text-cream/70">
                <EventLine ev={ev} />
              </li>
            ))}
        </ul>
      </aside>
    </div>
  );
}

function EventLine({ ev }: { ev: Event }) {
  switch (ev.type) {
    case 'tick_begin':
      return <>[{ev.tick}] tick_begin</>;
    case 'tick_end':
      return (
        <>
          [{ev.tick}] tick_end drama={ev.dramaScore.toFixed(2)} n={ev.liveAgentCount}
        </>
      );
    case 'action_completed':
      return (
        <>
          · {ev.agentId.slice(-4)}:{ev.tool}
          {ev.isError ? '✗' : '✓'}
        </>
      );
    case 'speech':
      return (
        <>
          💬 {ev.fromAgentId.slice(-4)}→{ev.toTarget}: "{ev.content.slice(0, 60)}"
        </>
      );
    case 'god_intervention_applied':
      return <span className="text-gold">⚡ GOD: {ev.description}</span>;
    case 'char_thinking':
      return <>... {ev.agentId.slice(-4)}</>;
    default:
      return <>{JSON.stringify(ev).slice(0, 80)}</>;
  }
}

function MapCanvas({ events }: { events: Event[] }) {
  // Minimal placeholder. v0.2: actual Konva canvas with sprites.
  const speechEvents = events.filter((e) => e.type === 'speech').slice(-5) as Array<
    Extract<Event, { type: 'speech' }>
  >;

  return (
    <div className="w-full h-full p-8 relative">
      <div className="absolute inset-8 border border-gold/20 rounded-md flex items-center justify-center">
        <div className="text-cream/40 text-sm">
          Map canvas — v0.2 will render characters, movement, bubbles here.
        </div>
      </div>
      <div className="absolute bottom-8 left-8 right-8 space-y-2">
        {speechEvents.map((e, i) => (
          <div
            key={i}
            className="bg-cream/10 border border-cream/20 rounded-md p-2 text-cream text-xs animate-in"
          >
            <span className="text-gold">{e.fromAgentId.slice(-4)}</span>
            <span className="text-cream/50"> → {e.toTarget}: </span>
            {e.content}
          </div>
        ))}
      </div>
    </div>
  );
}
