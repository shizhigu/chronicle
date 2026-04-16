/**
 * Home — the front door when there's no specific world picked.
 *
 * A landing page pointing visitors at the Gallery, the CLI install
 * path, and (if the world-state API is reachable) a live list of
 * worlds already on disk. Styled to match the dashboard's noir-gold
 * aesthetic so people don't land on a raw Tailwind-less HTML page.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router';

interface WorldRow {
  id: string;
  name: string;
  currentTick: number;
  status: string;
}

export function meta() {
  return [
    { title: 'Chronicle' },
    {
      name: 'description',
      content:
        'Multi-agent simulation where typed actions, rules, groups, and authority produce emergent political drama.',
    },
  ];
}

export default function Home() {
  const worlds = useWorlds();

  return (
    <div className="min-h-screen bg-abyss text-cream flex flex-col">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

      <main className="flex-1 flex flex-col items-center px-6 pt-20 pb-24">
        {/* Hero */}
        <div className="text-[11px] tracking-[0.4em] text-gold/80 uppercase font-mono mb-6">
          Chronicle &middot; v0.1.0-alpha
        </div>
        <h1
          className="text-7xl md:text-8xl text-gold leading-none text-center"
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontWeight: 700,
            letterSpacing: '0.01em',
          }}
        >
          Describe any world.
        </h1>
        <h2
          className="text-5xl md:text-6xl text-cream/70 leading-none mt-4 text-center"
          style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500, fontStyle: 'italic' }}
        >
          Watch it play out.
        </h2>
        <p className="mt-8 max-w-2xl text-center text-cream/60 text-lg leading-relaxed">
          A multi-agent simulation framework where AI-driven characters act inside typed rule
          systems and live governance structures. Run it from the terminal, steer it from Claude
          Code, watch it here.
        </p>

        {/* Install */}
        <div className="mt-14 w-full max-w-3xl">
          <div className="text-[10px] tracking-[0.3em] text-cream/40 uppercase font-mono mb-3">
            Quick start
          </div>
          <div className="rounded border border-gold/20 bg-[#07070a] p-5 font-mono text-sm leading-relaxed">
            <span className="text-cream/40">$ </span>
            <span className="text-cream">git clone https://github.com/shizhigu/chronicle</span>
            <br />
            <span className="text-cream/40">$ </span>
            <span className="text-cream">cd chronicle && bun install && bun run build</span>
            <br />
            <span className="text-cream/40">$ </span>
            <span className="text-gold">bun x chronicle</span>
            <span className="text-cream/40"> # interactive onboarding</span>
          </div>
        </div>

        {/* Worlds on disk */}
        <div className="mt-14 w-full max-w-3xl">
          <div className="text-[10px] tracking-[0.3em] text-cream/40 uppercase font-mono mb-3">
            Worlds on this machine{' '}
            {worlds === null ? (
              <span className="text-cream/30">&middot; scanning…</span>
            ) : (
              <span className="text-cream/30">&middot; {worlds.length}</span>
            )}
          </div>
          {worlds === null ? (
            <div className="text-cream/40 text-sm font-mono">
              Start the bridge with{' '}
              <code className="text-gold">chronicle dashboard &lt;worldId&gt;</code> to populate.
            </div>
          ) : worlds.length === 0 ? (
            <div className="rounded border border-cream/10 bg-[#0a0a0c] p-6 text-center text-cream/50 text-sm">
              No worlds yet. Create one:{' '}
              <code className="text-gold font-mono text-xs">
                bun x chronicle create-world --desc "…"
              </code>
            </div>
          ) : (
            <div className="border border-cream/10 rounded divide-y divide-cream/10 overflow-hidden">
              {worlds.map((w) => (
                <Link
                  key={w.id}
                  to={`/c/${w.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-gold/5 transition-colors group"
                >
                  <div>
                    <div className="text-cream group-hover:text-gold transition-colors">
                      {w.name}
                    </div>
                    <div className="text-[10px] tracking-[0.2em] text-cream/40 uppercase font-mono mt-0.5">
                      {w.id} &middot; tick {w.currentTick} &middot; {w.status}
                    </div>
                  </div>
                  <div className="text-gold/60 group-hover:text-gold text-xl">&rarr;</div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Links row */}
        <div className="mt-14 flex items-center gap-6 text-[11px] tracking-[0.25em] uppercase font-mono">
          <a
            href="https://github.com/shizhigu/chronicle"
            className="text-cream/50 hover:text-gold transition-colors"
          >
            GitHub &rarr;
          </a>
          <span className="text-cream/15">&middot;</span>
          <Link to="/gallery" className="text-cream/50 hover:text-gold transition-colors">
            Gallery
          </Link>
          <span className="text-cream/15">&middot;</span>
          <a
            href="https://github.com/shizhigu/chronicle/tree/main/docs/adr"
            className="text-cream/50 hover:text-gold transition-colors"
          >
            14 ADRs &rarr;
          </a>
        </div>
      </main>

      <footer className="border-t border-cream/10 px-6 py-4 text-center text-[10px] tracking-[0.25em] text-cream/30 uppercase font-mono">
        Built with pi-agent &middot; Designed for Claude Code
      </footer>
    </div>
  );
}

function useWorlds(): WorldRow[] | null {
  // Populate from the state API's index endpoint if exposed; otherwise
  // stay in the "scanning…" state. (The state server binds per-world,
  // so without a running bridge there's nothing to list.)
  const [worlds, setWorlds] = useState<WorldRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/worlds')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (cancelled || !data) return;
        const list = (data as { worlds?: WorldRow[] }).worlds ?? [];
        setWorlds(list);
      })
      .catch(() => {
        /* leave null — scanning… */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return worlds;
}
