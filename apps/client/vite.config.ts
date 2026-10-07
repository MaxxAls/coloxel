import { defineConfig } from 'vite';

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // Two pages: the game, and the administration for the staff.
  build: {
    rollupOptions: {
      input: { main: resolve(here, 'index.html'), admin: resolve(here, 'admin.html') },
      output: {
        // The big libraries change rarely: apart, a new version of the game does not make players download them again.
        manualChunks(id: string) {
          if (id.includes('node_modules/pixi.js') || id.includes('node_modules/@pixi')) return 'pixi';
          if (id.includes('node_modules/@colyseus')) return 'colyseus';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    // The website (/site) is served by the game server, next to the API.
    proxy: { '/api': 'http://localhost:3000', '/site': 'http://localhost:3000' },
  },
});
