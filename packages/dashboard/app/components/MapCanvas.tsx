/**
 * MapCanvas — real Konva canvas that renders characters + speech bubbles.
 *
 * Each agent becomes a circle+label. Movement events tween them to a new
 * location coordinate; speech events spawn a transient bubble above the
 * speaker that fades after a few seconds. Atmosphere tag tints the
 * background subtly (v0.2 will swap in tile sprites).
 *
 * This is intentionally simple — a diorama, not a game engine. The point is
 * that the user SEES the world move, not that they play it.
 */

import Konva from 'konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Layer, Rect, Stage, Text } from 'react-konva';

// ============================================================
// Types
// ============================================================

export interface AgentSprite {
  id: string;
  name: string;
  x: number;
  y: number;
  mood: string | null;
  locationId: string | null;
}

export interface LocationTile {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpeechBubble {
  id: string; // unique
  agentId: string;
  content: string;
  tone: string | null;
  spawnedAt: number; // epoch ms
}

export interface MapCanvasEvent {
  type:
    | 'agent_moved'
    | 'agent_spoke'
    | 'agent_joined'
    | 'agent_left'
    | 'catalyst'
    | 'god_intervention';
  agentId?: string;
  toLocationId?: string;
  content?: string;
  tone?: string | null;
  description?: string;
}

interface Props {
  width: number;
  height: number;
  agents: AgentSprite[];
  locations: LocationTile[];
  /** Events arriving live — MapCanvas translates them into sprite updates. */
  events: MapCanvasEvent[];
  atmosphereTag?: string;
}

// Bubble TTL in ms
const BUBBLE_TTL = 6000;

// ============================================================
// Component
// ============================================================

export function MapCanvas({ width, height, agents, locations, events, atmosphereTag }: Props) {
  const [bubbles, setBubbles] = useState<SpeechBubble[]>([]);
  const [flash, setFlash] = useState<{ description: string; at: number } | null>(null);

  // Maintain sprite positions with tween state
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() =>
    Object.fromEntries(agents.map((a) => [a.id, { x: a.x, y: a.y }])),
  );

  // When upstream agents change (e.g. new agents), seed positions for new ones
  useEffect(() => {
    setPositions((prev) => {
      const next = { ...prev };
      for (const a of agents) {
        if (!next[a.id]) next[a.id] = { x: a.x, y: a.y };
      }
      for (const id of Object.keys(next)) {
        if (!agents.find((a) => a.id === id)) delete next[id];
      }
      return next;
    });
  }, [agents]);

  // Translate events into visible effects
  useEffect(() => {
    if (events.length === 0) return;
    const last = events[events.length - 1];
    if (!last) return;
    const now = Date.now();

    if (last.type === 'agent_spoke' && last.agentId && last.content) {
      setBubbles((prev) => [
        ...prev.slice(-5), // keep at most 6 on-screen
        {
          id: `${last.agentId}-${now}-${Math.random().toString(36).slice(2, 6)}`,
          agentId: last.agentId,
          content: last.content,
          tone: last.tone ?? null,
          spawnedAt: now,
        },
      ]);
    }

    if (last.type === 'agent_moved' && last.agentId && last.toLocationId) {
      const target = locations.find((l) => l.id === last.toLocationId);
      if (target) {
        const tx = target.x + target.width / 2;
        const ty = target.y + target.height / 2;
        setPositions((prev) => ({
          ...prev,
          [last.agentId!]: { x: tx, y: ty },
        }));
      }
    }

    if (last.type === 'catalyst' || last.type === 'god_intervention') {
      setFlash({ description: last.description ?? '…', at: now });
    }
  }, [events, locations]);

  // Expire bubbles + flash after their TTL
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setBubbles((prev) => prev.filter((b) => now - b.spawnedAt < BUBBLE_TTL));
      if (flash && now - flash.at > 3500) setFlash(null);
    }, 400);
    return () => clearInterval(t);
  }, [flash]);

  const atmosphere = useMemo(() => atmosphereColor(atmosphereTag), [atmosphereTag]);

  return (
    <Stage width={width} height={height} style={{ background: atmosphere.bg }}>
      <Layer>
        {/* Atmospheric vignette */}
        <Rect x={0} y={0} width={width} height={height} fill={atmosphere.overlay} opacity={0.3} />

        {/* Location tiles */}
        {locations.map((loc) => (
          <>
            <Rect
              key={`tile-${loc.id}`}
              x={loc.x}
              y={loc.y}
              width={loc.width}
              height={loc.height}
              stroke={atmosphere.tile}
              strokeWidth={1}
              dash={[4, 4]}
              opacity={0.6}
              cornerRadius={4}
            />
            <Text
              key={`label-${loc.id}`}
              x={loc.x + 8}
              y={loc.y + 8}
              text={loc.name.toUpperCase()}
              fontSize={10}
              fontFamily="ui-monospace, Menlo, monospace"
              fill={atmosphere.tile}
              opacity={0.7}
            />
          </>
        ))}

        {/* Agents — circle + name label */}
        {agents.map((a) => {
          const pos = positions[a.id] ?? { x: a.x, y: a.y };
          const moodColor = moodToColor(a.mood);
          return (
            <AgentSpriteVisual
              key={a.id}
              id={a.id}
              x={pos.x}
              y={pos.y}
              name={a.name}
              moodColor={moodColor}
              textColor={atmosphere.text}
            />
          );
        })}

        {/* Speech bubbles */}
        {bubbles.map((b) => {
          const speaker = agents.find((a) => a.id === b.agentId);
          if (!speaker) return null;
          const pos = positions[speaker.id] ?? { x: speaker.x, y: speaker.y };
          return (
            <SpeechBubbleVisual
              key={b.id}
              x={pos.x + 18}
              y={pos.y - 36}
              text={b.content}
              tone={b.tone}
              atmosphere={atmosphere}
            />
          );
        })}

        {/* Catalyst / god flash */}
        {flash && (
          <>
            <Rect x={0} y={0} width={width} height={height} fill={atmosphere.flash} opacity={0.2} />
            <Text
              x={20}
              y={height - 64}
              width={width - 40}
              text={`⚡ ${flash.description}`}
              fontSize={14}
              fontFamily="ui-sans-serif, system-ui"
              fill={atmosphere.accent}
              opacity={1}
            />
          </>
        )}
      </Layer>
    </Stage>
  );
}

// ============================================================
// Sprite + bubble visuals with Konva tween on mount
// ============================================================

function AgentSpriteVisual(props: {
  id: string;
  x: number;
  y: number;
  name: string;
  moodColor: string;
  textColor: string;
}) {
  const circleRef = useRef<Konva.Circle | null>(null);
  const prevPos = useRef({ x: props.x, y: props.y });

  useEffect(() => {
    if (!circleRef.current) return;
    if (prevPos.current.x === props.x && prevPos.current.y === props.y) return;
    const tween = new Konva.Tween({
      node: circleRef.current,
      duration: 0.6,
      x: props.x,
      y: props.y,
      easing: Konva.Easings.EaseInOut,
    });
    tween.play();
    prevPos.current = { x: props.x, y: props.y };
    return () => tween.destroy();
  }, [props.x, props.y]);

  return (
    <>
      <Circle
        ref={circleRef as never}
        x={props.x}
        y={props.y}
        radius={10}
        fill={props.moodColor}
        stroke="#f3eadb"
        strokeWidth={1.5}
      />
      <Text
        x={props.x - 40}
        y={props.y + 14}
        width={80}
        align="center"
        text={props.name}
        fontSize={10}
        fontFamily="ui-monospace, Menlo, monospace"
        fill={props.textColor}
      />
    </>
  );
}

function SpeechBubbleVisual(props: {
  x: number;
  y: number;
  text: string;
  tone: string | null;
  atmosphere: AtmosphereTheme;
}) {
  const groupRef = useRef<Konva.Text | null>(null);
  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.opacity(0);
    const tween = new Konva.Tween({
      node: groupRef.current,
      duration: 0.25,
      opacity: 1,
      easing: Konva.Easings.EaseOut,
    });
    tween.play();
    return () => tween.destroy();
  }, []);

  const bg =
    props.tone === 'angry' || props.tone === 'shouted'
      ? '#3a0f0f'
      : props.tone === 'whispered'
        ? '#0f1a2a'
        : props.atmosphere.bubble;

  const truncated = props.text.length > 120 ? `${props.text.slice(0, 117)}…` : props.text;
  const maxWidth = 220;
  const padding = 8;
  const approxCharW = 6;
  const approxLineH = 14;
  const estLines = Math.max(
    1,
    Math.ceil((truncated.length * approxCharW) / (maxWidth - padding * 2)),
  );
  const bubbleH = estLines * approxLineH + padding * 2;

  return (
    <>
      <Rect
        x={props.x}
        y={props.y - bubbleH}
        width={maxWidth}
        height={bubbleH}
        fill={bg}
        stroke={props.atmosphere.accent}
        strokeWidth={1}
        cornerRadius={6}
        opacity={0.95}
      />
      <Text
        ref={groupRef as never}
        x={props.x + padding}
        y={props.y - bubbleH + padding}
        width={maxWidth - padding * 2}
        text={truncated}
        fontSize={11}
        lineHeight={1.25}
        fontFamily="ui-sans-serif, system-ui"
        fill="#f3eadb"
        wrap="word"
      />
    </>
  );
}

// ============================================================
// Theme
// ============================================================

interface AtmosphereTheme {
  bg: string;
  overlay: string;
  tile: string;
  text: string;
  accent: string;
  bubble: string;
  flash: string;
}

function atmosphereColor(tag?: string): AtmosphereTheme {
  switch (tag) {
    case 'survival_thriller':
      return {
        bg: '#0a0d0f',
        overlay: '#0a2230',
        tile: '#6e8a96',
        text: '#e8eef2',
        accent: '#c97c3c',
        bubble: '#12202a',
        flash: '#c97c3c',
      };
    case 'parlor_drama':
      return {
        bg: '#120a1a',
        overlay: '#2a0e1e',
        tile: '#b08da5',
        text: '#f3eadb',
        accent: '#d6a24f',
        bubble: '#1a1020',
        flash: '#d6a24f',
      };
    case 'tech_workplace':
      return {
        bg: '#0b0f17',
        overlay: '#0d1a2b',
        tile: '#6c8ab0',
        text: '#e8eef2',
        accent: '#4ea8ff',
        bubble: '#0f1928',
        flash: '#4ea8ff',
      };
    case 'teen_drama':
      return {
        bg: '#1a0a1a',
        overlay: '#2a0a2a',
        tile: '#b56fb0',
        text: '#f3eadb',
        accent: '#ff78c9',
        bubble: '#200a22',
        flash: '#ff78c9',
      };
    case 'medieval_court':
      return {
        bg: '#0a0906',
        overlay: '#201808',
        tile: '#a89068',
        text: '#f3eadb',
        accent: '#d6a24f',
        bubble: '#170f05',
        flash: '#d6a24f',
      };
    default:
      return {
        bg: '#0a0a0a',
        overlay: '#0f0f14',
        tile: '#8f8872',
        text: '#e8eef2',
        accent: '#d6a24f',
        bubble: '#0e0e12',
        flash: '#d6a24f',
      };
  }
}

function moodToColor(mood: string | null): string {
  if (!mood) return '#8a8a7f';
  const m = mood.toLowerCase();
  if (/(angry|enraged|furious|hostile)/.test(m)) return '#c0392b';
  if (/(sad|grieving|melancholy|mournful)/.test(m)) return '#34536a';
  if (/(happy|joy|content|glad)/.test(m)) return '#d6a24f';
  if (/(scared|afraid|anxious|worried|nervous)/.test(m)) return '#5f4a80';
  if (/(hopeful|relieved|calm|peaceful)/.test(m)) return '#6aa37e';
  if (/(determined|focused|resolute)/.test(m)) return '#c97c3c';
  return '#8a8a7f';
}
