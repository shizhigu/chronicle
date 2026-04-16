/**
 * Stub WebSocket route — React Router doesn't handle WS natively.
 * The actual WebSocket server runs as a separate process started by
 * the CLI (chronicle dashboard) on port 7071. This file exists so
 * routes.ts has a valid resolver, but returns a helpful error.
 */

import type { Route } from './+types/api.ws';

export async function loader({ params }: Route.LoaderArgs) {
  return Response.json(
    {
      error: 'websocket_not_on_http_route',
      hint: `Connect to ws://localhost:7071/api/ws/${params.worldId ?? ''}`,
    },
    { status: 426 },
  );
}

export default function WsRoute() {
  return null;
}
