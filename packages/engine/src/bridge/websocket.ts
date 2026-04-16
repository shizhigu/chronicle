/**
 * WebSocket bridge — fans out EventBus events to browser clients.
 *
 * Runs in the same process as the Engine (CLI or dashboard server).
 * Browser clients subscribe to ws://host/api/ws/:worldId and receive
 * a stream of JSON events.
 *
 * Runtime: Bun. Uses the built-in `Bun.serve({ websocket })` handler
 * — no `ws` dependency.
 */

import type { Server, ServerWebSocket } from 'bun';
import type { BusEvent, EventBus } from '../events/bus.js';

// Local helpers: the Bun types are strict on route maps; we don't use routes
// so a trimmed fetch/websocket server config is all we need.
type BunServerCtor = (opts: {
  port: number;
  fetch: (
    req: Request,
    server: Server<SocketContext>,
  ) => Response | undefined | Promise<Response | undefined>;
  websocket: {
    open: (ws: ServerWebSocket<SocketContext>) => void;
    message: (ws: ServerWebSocket<SocketContext>, msg: string | Buffer) => void;
    close: (ws: ServerWebSocket<SocketContext>) => void;
    drain?: (ws: ServerWebSocket<SocketContext>) => void;
  };
}) => Server<SocketContext>;

export interface BridgeOpts {
  port: number;
  /** Regexp that matches the URL path and yields the worldId as capture group 1. */
  pathPattern?: RegExp;
  /** Invoked when a client connects — use to replay backlog or register per-connection state. */
  onClientConnect?: (worldId: string, send: (event: BusEvent) => void) => void;
}

interface SocketContext {
  worldId: string;
}

export class WebSocketBridge {
  private server?: Server<SocketContext>;
  private clients = new Map<string, Set<ServerWebSocket<SocketContext>>>(); // worldId → sockets
  private unsubscribe?: () => void;

  constructor(
    private bus: EventBus,
    private opts: BridgeOpts,
  ) {}

  start(): void {
    const pathPattern = this.opts.pathPattern ?? /\/api\/ws\/([a-z0-9_-]+)/;

    // Bun.serve's top-level generics handle route configs we don't use; cast to
    // a narrower signature that exposes only the plain fetch + websocket handlers.
    this.server = (Bun.serve as unknown as BunServerCtor)({
      port: this.opts.port,
      fetch: (req, server) => {
        const url = new URL(req.url);
        const match = url.pathname.match(pathPattern);
        if (!match) {
          return new Response('bad path', { status: 404 });
        }
        const worldId = match[1]!;
        const upgraded = server.upgrade(req, { data: { worldId } });
        if (upgraded) return undefined;
        return new Response('upgrade required', { status: 426 });
      },
      websocket: {
        open: (ws) => {
          const { worldId } = ws.data;
          let set = this.clients.get(worldId);
          if (!set) {
            set = new Set();
            this.clients.set(worldId, set);
          }
          set.add(ws);
          if (this.opts.onClientConnect) {
            this.opts.onClientConnect(worldId, (event) => this.sendTo(ws, event));
          }
        },
        message: (_ws, _msg) => {
          // Currently read-only. Future: accept agent interventions over WS.
        },
        close: (ws) => {
          const set = this.clients.get(ws.data.worldId);
          set?.delete(ws);
          if (set && set.size === 0) this.clients.delete(ws.data.worldId);
        },
        drain: (_ws) => {
          // Backpressure hook — no-op for now.
        },
      },
    });

    // Fanout subscription
    this.unsubscribe = this.bus.subscribe((event) => {
      const worldId = (event as { worldId?: string }).worldId;
      if (!worldId) return;
      const sockets = this.clients.get(worldId);
      if (!sockets) return;
      for (const s of sockets) {
        this.sendTo(s, event);
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
    for (const sockets of this.clients.values()) {
      for (const s of sockets) s.close();
    }
    this.clients.clear();
    this.server?.stop(true);
    this.server = undefined;
  }

  /** Count of connected clients for a given world (useful in tests + metrics). */
  clientCount(worldId: string): number {
    return this.clients.get(worldId)?.size ?? 0;
  }

  private sendTo(socket: ServerWebSocket<SocketContext>, event: BusEvent): void {
    try {
      socket.send(JSON.stringify(event));
    } catch {
      // client may have disconnected; drop silently
    }
  }
}
