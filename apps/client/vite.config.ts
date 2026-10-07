import { defineConfig } from 'vite';

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // Two pages: the game, and the administration for the staff.
  build: { rollupOptions: { input: { main: resolve(here, 'index.html'), admin: resolve(here, 'admin.html') } } },
  server: {
    port: 5173,
    // The website (/site) is served by the game server, next to the API.
    proxy: { '/api': 'http://localhost:3000', '/site': 'http://localhost:3000' },
  },
});
