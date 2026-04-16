import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('./routes/home.tsx'),
  route('c/:worldId', './routes/chronicle.tsx', [
    index('./routes/chronicle.live.tsx'),
    route('gazette', './routes/chronicle.gazette.tsx'),
    route('whispers/:agentId', './routes/chronicle.whispers.tsx'),
    route('reel', './routes/chronicle.reel.tsx'),
  ]),
  route('r/:worldId', './routes/replay.tsx'),
  route('gallery', './routes/gallery.tsx'),
  route('api/ws/:worldId', './routes/api.ws.tsx'),
] satisfies RouteConfig;
