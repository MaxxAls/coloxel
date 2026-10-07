import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // The website (/site) is served by the game server, next to the API.
    proxy: { '/api': 'http://localhost:3000', '/site': 'http://localhost:3000' },
  },
});
