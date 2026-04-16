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
  /** Optional override emoji; if unset, we hash agent.id into a palette. */
  emoji?: string;
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
  /** Current world tick. Used for day/night tint when dayNightCycleTicks is set. */
  tick?: number;
  /** Full day+night cycle length in ticks. null / 0 = no cycle. */
  dayNightCycleTicks?: number | null;
}

// Bubble TTL in ms
const BUBBLE_TTL = 6000;

// ============================================================
// Component
// ============================================================

export function MapCanvas({
  width,
  height,
  agents,
  locations,
  events,
  atmosphereTag,
  tick = 0,
  dayNightCycleTicks,
}: Props) {
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
  const cyclePhase = useMemo(
    () => computeCyclePhase(tick, dayNightCycleTicks),
    [tick, dayNightCycleTicks],
  );

  return (
    <Stage width={width} height={height} style={{ background: atmosphere.bg }}>
      <Layer>
        {/* Atmospheric vignette */}
        <Rect x={0} y={0} width={width} height={height} fill={atmosphere.overlay} opacity={0.3} />

        {/* Day/night tint — blue overlay at night, gold at dusk */}
        {cyclePhase && (
          <Rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill={cyclePhase.tint}
            opacity={cyclePhase.opacity}
          />
        )}

        {/* Location tiles */}
        {locations.map((loc) => (
          <LocationTileVisual key={loc.id} loc={loc} stroke={atmosphere.tile} />
        ))}

        {/* Agents — emoji avatar + mood halo + name label */}
        {agents.map((a) => {
          const pos = positions[a.id] ?? { x: a.x, y: a.y };
          const moodColor = moodToColor(a.mood);
          const moodAnim = moodToAnimation(a.mood);
          const emoji = a.emoji ?? pickEmojiFor(a.id);
          return (
            <AgentSpriteVisual
              key={a.id}
              id={a.id}
              x={pos.x}
              y={pos.y}
              name={a.name}
              emoji={emoji}
              moodColor={moodColor}
              moodAnim={moodAnim}
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
          <FlashOverlay
            width={width}
            height={height}
            description={flash.description}
            atmosphere={atmosphere}
          />
        )}
      </Layer>
    </Stage>
  );
}

function LocationTileVisual({ loc, stroke }: { loc: LocationTile; stroke: string }) {
  return (
    <>
      <Rect
        x={loc.x}
        y={loc.y}
        width={loc.width}
        height={loc.height}
        stroke={stroke}
        strokeWidth={1}
        dash={[4, 4]}
        opacity={0.6}
        cornerRadius={4}
      />
      <Text
        x={loc.x + 8}
        y={loc.y + 8}
        text={loc.name.toUpperCase()}
        fontSize={10}
        fontFamily="ui-monospace, Menlo, monospace"
        fill={stroke}
        opacity={0.7}
      />
    </>
  );
}

function FlashOverlay({
  width,
  height,
  description,
  atmosphere,
}: {
  width: number;
  height: number;
  description: string;
  atmosphere: AtmosphereTheme;
}) {
  return (
    <>
      <Rect x={0} y={0} width={width} height={height} fill={atmosphere.flash} opacity={0.2} />
      <Text
        x={20}
        y={height - 64}
        width={width - 40}
        text={`⚡ ${description}`}
        fontSize={14}
        fontFamily="ui-sans-serif, system-ui"
        fill={atmosphere.accent}
        opacity={1}
      />
    </>
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
  emoji: string;
  moodColor: string;
  moodAnim: MoodAnimation;
  textColor: string;
}) {
  const haloRef = useRef<Konva.Circle | null>(null);
  const emojiRef = useRef<Konva.Text | null>(null);
  const prevPos = useRef({ x: props.x, y: props.y });

  // Tween to new position on any change
  useEffect(() => {
    if (prevPos.current.x === props.x && prevPos.current.y === props.y) return;
    const nodes = [haloRef.current, emojiRef.current].filter(Boolean) as Konva.Node[];
    const tweens = nodes.map((n) => {
      // emoji has its own offset, so compute deltas per-node
      const t = new Konva.Tween({
        node: n,
        duration: 0.5,
        x: props.x + (n === emojiRef.current ? -10 : 0),
        y: props.y + (n === emojiRef.current ? -10 : 0),
        easing: Konva.Easings.EaseInOut,
      });
      t.play();
      return t;
    });
    prevPos.current = { x: props.x, y: props.y };
    return () => tweens.forEach((t) => t.destroy());
  }, [props.x, props.y]);

  // Mood-driven ambient animation on the halo
  useEffect(() => {
    if (!haloRef.current) return;
    const node = haloRef.current;
    const anim = props.moodAnim;
    if (anim.kind === 'none') return;

    const konvaAnim = new Konva.Animation((frame) => {
      if (!frame) return;
      const t = frame.time / 1000;
      switch (anim.kind) {
        case 'pulse':
          node.scaleX(1 + 0.15 * Math.sin(t * anim.speed));
          node.scaleY(1 + 0.15 * Math.sin(t * anim.speed));
          break;
        case 'shake':
          node.x(props.x + Math.sin(t * 40) * 1.5);
          break;
        case 'shrink':
          node.opacity(0.35);
          node.scaleX(0.85);
          node.scaleY(0.85);
          break;
      }
    }, node.getLayer());
    konvaAnim.start();
    return () => {
      konvaAnim.stop();
      node.x(props.x);
      node.opacity(1);
      node.scaleX(1);
      node.scaleY(1);
    };
  }, [props.moodAnim, props.x]);

  return (
    <>
      {/* Halo — colored mood backdrop that animates */}
      <Circle
        ref={haloRef as never}
        x={props.x}
        y={props.y}
        radius={14}
        fill={props.moodColor}
        opacity={0.55}
      />
      {/* Emoji avatar — the little person */}
      <Text
        ref={emojiRef as never}
        x={props.x - 10}
        y={props.y - 10}
        text={props.emoji}
        fontSize={20}
        fontFamily="'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif"
      />
      {/* Name label below */}
      <Text
        x={props.x - 40}
        y={props.y + 16}
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

// ============================================================
// Mood + emoji + day/night helpers
// ============================================================

type MoodAnimation =
  | { kind: 'none' }
  | { kind: 'pulse'; speed: number }
  | { kind: 'shake' }
  | { kind: 'shrink' };

function moodToAnimation(mood: string | null): MoodAnimation {
  if (!mood) return { kind: 'none' };
  const m = mood.toLowerCase();
  if (/(angry|enraged|furious|hostile)/.test(m)) return { kind: 'shake' };
  if (/(happy|joy|content|glad|hopeful|relieved)/.test(m)) return { kind: 'pulse', speed: 3 };
  if (/(scared|afraid|anxious|worried|nervous)/.test(m)) return { kind: 'shrink' };
  if (/(determined|focused|resolute)/.test(m)) return { kind: 'pulse', speed: 5 };
  return { kind: 'none' };
}

/** Deterministic emoji pick — same agent id always picks the same emoji. */
const EMOJI_PALETTE = [
  '👤',
  '🧑',
  '👩',
  '👨',
  '🧔',
  '👴',
  '👵',
  '🧙',
  '🧛',
  '🧜',
  '🧝',
  '🧞',
  '🤠',
  '🥷',
  '👷',
  '👮',
  '🕵️',
  '🧑‍⚕️',
  '🧑‍🌾',
  '🧑‍🍳',
  '🧑‍🎨',
  '🧑‍🚀',
  '🐱',
  '🐶',
  '🦊',
  '🐺',
  '🦉',
  '🐉',
];

function pickEmojiFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return EMOJI_PALETTE[h % EMOJI_PALETTE.length]!;
}

/** Returns a tint overlay based on time of day, or null if no cycle configured. */
function computeCyclePhase(
  tick: number,
  cycleTicks?: number | null,
): { tint: string; opacity: number } | null {
  if (!cycleTicks || cycleTicks <= 0) return null;
  const phase = (tick % cycleTicks) / cycleTicks; // 0..1
  // 0.0 — dawn (warm light)
  // 0.25 — midday (no tint)
  // 0.5 — dusk (orange)
  // 0.75 — midnight (deep blue)
  if (phase < 0.1) return { tint: '#f5cf6b', opacity: 0.12 }; // dawn
  if (phase < 0.4) return null; // midday: no overlay
  if (phase < 0.55) return { tint: '#d67c3c', opacity: 0.18 }; // dusk
  if (phase < 0.85) return { tint: '#0a1f3a', opacity: 0.35 }; // night
  return { tint: '#3a1c3a', opacity: 0.22 }; // pre-dawn
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
