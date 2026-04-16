import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  server: {
    port: 7070,
    // In dev the world-state HTTP API runs on :7072 (spawned by
    // `chronicle dashboard <worldId>`). Proxy /api through so the
    // live route can fetch relative URLs and keep WS traffic separate.
    proxy: {
      '/api/worlds': {
        target: 'http://localhost:7072',
        changeOrigin: false,
      },
    },
  },
});
