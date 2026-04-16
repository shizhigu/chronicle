/**
 * Live view — a ticking diorama. Subscribes to the engine's WebSocket bridge,
 * accumulates events, and feeds them to MapCanvas which renders agents, speech
 * bubbles, and catalyst flashes. The right sidebar keeps a scrolling event log
 * for readers who prefer text.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  type AgentSprite,
  type LocationTile,
  MapCanvas,
  type MapCanvasEvent,
} from '../components/MapCanvas';

type WireEvent =
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
  | { type: 'char_thinking'; agentId: string; delta: unknown }
  | { type: 'catalyst'; tick: number; description: string };

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 560;

export default function LiveView() {
  const { worldId } = useParams();
  const [events, setEvents] = useState<WireEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [agents, setAgents] = useState<AgentSprite[]>([]);
  const [locations, setLocations] = useState<LocationTile[]>([]);
  const [mapEvents, setMapEvents] = useState<MapCanvasEvent[]>([]);
  const [atmosphereTag, setAtmosphereTag] = useState<string | undefined>(undefined);
  const [dayNightCycleTicks, setDayNightCycleTicks] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Initial world state fetch (locations + agent roster)
  useEffect(() => {
    if (!worldId) return;
    fetch(`/api/worlds/${worldId}/state`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setLocations(layoutLocations(data.locations ?? []));
        setAgents(placeAgents(data.agents ?? [], data.locations ?? []));
        if (data.world?.atmosphereTag) setAtmosphereTag(data.world.atmosphereTag);
        if (data.world?.dayNightCycleTicks != null) {
          setDayNightCycleTicks(data.world.dayNightCycleTicks);
        }
      })
      .catch(() => {
        /* ok — use demo placeholder */
      });
  }, [worldId]);

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
        const ev = JSON.parse(msg.data) as WireEvent;
        setEvents((prev) => [...prev.slice(-200), ev]);

        const translated = translateForCanvas(ev);
        if (translated) setMapEvents((prev) => [...prev.slice(-60), translated]);
      } catch {
        // ignore malformed
      }
    };

    return () => ws.close();
  }, [worldId]);

  const latestTick = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e?.type === 'tick_begin' || e?.type === 'tick_end') return e.tick;
    }
    return 0;
  }, [events]);

  const latestDrama = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e?.type === 'tick_end') return e.dramaScore;
    }
    return 0;
  }, [events]);

  return (
    <div className="grid grid-cols-[1fr_340px] min-h-full bg-abyss">
      <div className="relative border-r border-cream/10 p-4">
        <div className="rounded-lg overflow-hidden border border-cream/10 bg-[#0a0a0a]">
          {agents.length === 0 && locations.length === 0 ? (
            <DemoCanvas />
          ) : (
            <MapCanvas
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              agents={agents}
              locations={locations}
              events={mapEvents}
              atmosphereTag={atmosphereTag}
              tick={latestTick}
              dayNightCycleTicks={dayNightCycleTicks}
            />
          )}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-cream/50">
          <div>
            <span className="text-gold">● tick</span> {latestTick}
          </div>
          <div>
            drama {latestDrama.toFixed(2)}
            <span className="ml-3">
              {connected ? (
                <span className="text-gold">● live</span>
              ) : (
                <span className="text-cream/40">○ offline</span>
              )}
            </span>
          </div>
        </div>
      </div>
      <aside className="p-4 text-sm overflow-auto max-h-[calc(100vh-2rem)]">
        <h2 className="text-gold mb-2 text-xs uppercase tracking-wider">Event stream</h2>
        <ul className="space-y-1 font-mono text-[11px]">
          {events
            .slice(-80)
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

function EventLine({ ev }: { ev: WireEvent }) {
  switch (ev.type) {
    case 'tick_begin':
      return <span className="text-cream/50">[{ev.tick}] tick_begin</span>;
    case 'tick_end':
      return (
        <>
          [{ev.tick}] tick_end <span className="text-gold">drama={ev.dramaScore.toFixed(2)}</span>{' '}
          n={ev.liveAgentCount}
        </>
      );
    case 'action_completed':
      return (
        <>
          · {ev.agentId.slice(-4)}:{ev.tool}
          {ev.isError ? ' ✗' : ' ✓'}
        </>
      );
    case 'speech':
      return (
        <>
          💬 {ev.fromAgentId.slice(-4)} → {ev.toTarget}:{' '}
          <span className="text-cream">"{ev.content.slice(0, 80)}"</span>
        </>
      );
    case 'god_intervention_applied':
      return <span className="text-gold">⚡ GOD: {ev.description}</span>;
    case 'catalyst':
      return <span className="text-gold/80">✨ {ev.description}</span>;
    case 'char_thinking':
      return <span className="text-cream/40">… {ev.agentId.slice(-4)} thinking</span>;
    default:
      return <>{JSON.stringify(ev).slice(0, 80)}</>;
  }
}

// ============================================================
// Helpers: layout + translation
// ============================================================

interface ServerLocation {
  id: string;
  name: string;
  x?: number | null;
  y?: number | null;
}

interface ServerAgent {
  id: string;
  name: string;
  locationId: string | null;
  mood: string | null;
}

function layoutLocations(locs: ServerLocation[]): LocationTile[] {
  if (locs.length === 0) return [];
  // Grid layout if we have no coordinates
  const cols = Math.ceil(Math.sqrt(locs.length));
  const rows = Math.ceil(locs.length / cols);
  const margin = 40;
  const tileW = Math.floor((CANVAS_WIDTH - margin * 2) / cols);
  const tileH = Math.floor((CANVAS_HEIGHT - margin * 2) / rows);
  return locs.map((l, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = margin + c * tileW;
    const y = margin + r * tileH;
    return { id: l.id, name: l.name, x, y, width: tileW - 12, height: tileH - 12 };
  });
}

function placeAgents(agents: ServerAgent[], locs: ServerLocation[]): AgentSprite[] {
  const tiles = layoutLocations(locs);
  const byLoc = new Map(tiles.map((t) => [t.id, t]));
  const counters: Record<string, number> = {};

  return agents.map((a) => {
    if (!a.locationId) {
      return {
        id: a.id,
        name: a.name,
        x: CANVAS_WIDTH - 40,
        y: 40,
        mood: a.mood,
        locationId: null,
      };
    }
    const tile = byLoc.get(a.locationId);
    if (!tile) {
      return { id: a.id, name: a.name, x: 0, y: 0, mood: a.mood, locationId: a.locationId };
    }
    const idx = counters[tile.id] ?? 0;
    counters[tile.id] = idx + 1;
    // Cluster agents inside their tile
    const pad = 20;
    const gx = (idx % 3) * ((tile.width - pad * 2) / 3) + pad;
    const gy = Math.floor(idx / 3) * 28 + pad + 16;
    return {
      id: a.id,
      name: a.name,
      x: tile.x + gx,
      y: tile.y + gy,
      mood: a.mood,
      locationId: a.locationId,
    };
  });
}

function translateForCanvas(ev: WireEvent): MapCanvasEvent | null {
  if (ev.type === 'speech') {
    return {
      type: 'agent_spoke',
      agentId: ev.fromAgentId,
      content: ev.content,
      tone: ev.tone,
    };
  }
  if (ev.type === 'action_completed' && ev.tool === 'move' && !ev.isError) {
    // Canvas doesn't know destination from action_completed alone; a follow-up
    // state delta event would carry it. For now, no-op — v0.3 adds delta stream.
    return null;
  }
  if (ev.type === 'god_intervention_applied') {
    return { type: 'god_intervention', description: ev.description };
  }
  if (ev.type === 'catalyst') {
    return { type: 'catalyst', description: ev.description };
  }
  return null;
}

function DemoCanvas() {
  // When no world state is available (SSR preview / pre-connect), show a static
  // sample so the UX isn't a blank rectangle.
  return (
    <MapCanvas
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      atmosphereTag="parlor_drama"
      locations={[
        { id: 'l1', name: 'parlor', x: 80, y: 80, width: 300, height: 200 },
        { id: 'l2', name: 'study', x: 520, y: 80, width: 300, height: 200 },
        { id: 'l3', name: 'garden', x: 80, y: 320, width: 740, height: 180 },
      ]}
      agents={[
        { id: 'a1', name: 'Host', x: 160, y: 160, mood: 'content', locationId: 'l1' },
        { id: 'a2', name: 'Butler', x: 260, y: 180, mood: 'scared', locationId: 'l1' },
        { id: 'a3', name: 'Guest', x: 600, y: 160, mood: 'calm', locationId: 'l2' },
        { id: 'a4', name: 'Stranger', x: 400, y: 400, mood: 'determined', locationId: 'l3' },
      ]}
      events={[]}
    />
  );
}
