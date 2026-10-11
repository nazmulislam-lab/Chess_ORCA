import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // three.js is lazy-loaded only when the 3D board is switched on.
  build: { chunkSizeWarningLimit: 900 },
  server: {
    // Online games: forward the WebSocket to `npm run server` during development.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
});
