/**
 * Chronicle layout — the shell every per-world route sits inside.
 *
 * Pulls the world snapshot from the state API (via the :7070 → :7072
 * vite proxy) so the header shows real name/tick/status instead of a
 * placeholder. Client-side fetch because SPA mode; the loader just
 * passes the worldId through.
 */

import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import type { Route } from './+types/chronicle';

interface WorldSnapshot {
  id: string;
  name: string;
  currentTick: number;
  status: string;
  atmosphere?: string;
  atmosphereTag?: string;
}

export async function loader({ params }: Route.LoaderArgs) {
  return { worldId: params.worldId };
}

export default function ChronicleLayout() {
  const { worldId } = useLoaderData();
  const world = useWorldPoll(worldId);

  return (
    <div className="min-h-screen flex flex-col bg-abyss text-cream">
      <Header world={world} worldId={worldId} />
      <Nav />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

function useLoaderData(): { worldId: string } {
  // Small shim so we don't drag in the full useLoaderData import path
  // from react-router just for one value.
  const r = (globalThis as { __rr_data?: { worldId: string } }).__rr_data;
  if (r) return r;
  // Fallback: parse the URL
  const m = typeof window !== 'undefined' ? window.location.pathname.match(/\/c\/([^/]+)/) : null;
  return { worldId: m?.[1] ?? '' };
}

function useWorldPoll(worldId: string): WorldSnapshot | null {
  const [world, setWorld] = useState<WorldSnapshot | null>(null);
  useEffect(() => {
    if (!worldId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/worlds/${worldId}/state`);
        if (!res.ok) return;
        const data = (await res.json()) as { world: WorldSnapshot };
        if (!cancelled) setWorld(data.world);
      } catch {
        /* ignore transient */
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [worldId]);
  return world;
}

function Header({ world, worldId }: { world: WorldSnapshot | null; worldId: string }) {
  const name = world?.name ?? 'Loading…';
  const tick = world?.currentTick ?? 0;
  const status = world?.status ?? '—';
  const atmosphere = world?.atmosphere ?? '—';
  return (
    <header className="relative border-b border-gold/25 bg-[linear-gradient(180deg,#0f0d0a_0%,#0a0a0c_100%)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
      <div className="px-8 py-5 flex items-end justify-between">
        <div>
          <div className="text-[11px] tracking-[0.3em] text-gold/70 uppercase font-mono">
            Chronicle
          </div>
          <h1
            className="text-4xl text-gold leading-none mt-1"
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontWeight: 700,
              letterSpacing: '0.02em',
            }}
          >
            {name}
          </h1>
          <div className="mt-2 text-xs text-cream/50 font-mono">
            <span className="text-cream/40">world</span>{' '}
            <span className="text-cream/70">{worldId}</span>
            <span className="mx-3 text-cream/20">·</span>
            <span className="text-cream/40">atmosphere</span>{' '}
            <span className="text-cream/70">{atmosphere}</span>
          </div>
        </div>
        <div className="flex items-center gap-8">
          <Meter label="TICK" value={String(tick)} />
          <Meter label="STATUS" value={status} accent={status === 'running' ? 'gold' : 'dim'} />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent" />
    </header>
  );
}

function Meter({
  label,
  value,
  accent = 'dim',
}: {
  label: string;
  value: string;
  accent?: 'gold' | 'dim';
}) {
  return (
    <div className="text-right">
      <div className="text-[10px] tracking-[0.25em] text-cream/40 font-mono">{label}</div>
      <div
        className={`text-2xl font-mono mt-0.5 ${accent === 'gold' ? 'text-gold' : 'text-cream/90'}`}
        style={{ fontFamily: 'JetBrains Mono, monospace' }}
      >
        {value}
      </div>
    </div>
  );
}

function Nav() {
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 text-[11px] tracking-[0.25em] uppercase font-mono border-b-2 transition-colors ${
      isActive ? 'text-gold border-gold' : 'text-cream/50 border-transparent hover:text-cream'
    }`;
  return (
    <nav className="px-6 border-b border-cream/10 bg-[#07070a] flex gap-1">
      <NavLink to="." end className={linkCls}>
        Live
      </NavLink>
      <NavLink to="gazette" className={linkCls}>
        Gazette
      </NavLink>
      <NavLink to="whispers/first" className={linkCls}>
        Whispers
      </NavLink>
      <NavLink to="reel" className={linkCls}>
        Reel
      </NavLink>
    </nav>
  );
}
