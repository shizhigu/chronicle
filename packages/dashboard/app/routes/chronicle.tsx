import { NavLink, Outlet, useLoaderData } from 'react-router';
import type { Route } from './+types/chronicle';

export async function loader({ params }: Route.LoaderArgs) {
  // In v0.1 this is a stub. v0.2: load world metadata from engine via REST.
  return {
    worldId: params.worldId,
    world: {
      name: 'Loading...',
      currentTick: 0,
      status: 'unknown',
    },
  };
}

export default function ChronicleLayout() {
  const { worldId, world } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-cream/10 px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gold">{world.name}</h1>
          <div className="text-xs text-cream/60">
            {worldId} · tick {world.currentTick} · {world.status}
          </div>
        </div>
        <div className="text-sm text-cream/50">Chronicle</div>
      </header>

      <nav className="px-6 py-2 border-b border-cream/10 flex gap-4 text-sm">
        <NavLink
          to="."
          end
          className={({ isActive }) => (isActive ? 'text-gold' : 'text-cream/60 hover:text-cream')}
        >
          Live
        </NavLink>
        <NavLink
          to="gazette"
          className={({ isActive }) => (isActive ? 'text-gold' : 'text-cream/60 hover:text-cream')}
        >
          Gazette
        </NavLink>
        <NavLink
          to={'whispers/first'}
          className={({ isActive }) => (isActive ? 'text-gold' : 'text-cream/60 hover:text-cream')}
        >
          Whispers
        </NavLink>
        <NavLink
          to="reel"
          className={({ isActive }) => (isActive ? 'text-gold' : 'text-cream/60 hover:text-cream')}
        >
          Reel
        </NavLink>
      </nav>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
