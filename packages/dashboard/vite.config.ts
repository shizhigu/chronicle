import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [reactRouter(), tsconfigPaths()],
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
  // Konva resolves to its `-node` variant when Vite sees us via a
  // bundling path that looks Node-like; force the web build so
  // react-konva loads the DOM renderer and doesn't demand the native
  // `canvas` package.
  resolve: {
    alias: {
      konva: 'konva/lib/index.js',
    },
  },
  optimizeDeps: {
    exclude: ['konva/lib/index-node.js'],
  },
});
