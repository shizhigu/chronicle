import type { Config } from '@react-router/dev/config';

export default {
  // Konva's canvas renderer can't run under Node SSR without the
  // native `canvas` package (expensive to install, flaky on macOS).
  // A live dashboard fundamentally needs the client anyway — every
  // route depends on WebSocket state that only exists in the browser —
  // so SPA mode costs nothing and avoids a class of Konva bugs.
  ssr: false,
} satisfies Config;
