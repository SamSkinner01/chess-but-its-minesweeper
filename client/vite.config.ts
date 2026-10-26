import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: {
    // The server bundle (dist/server.js) serves this folder in production.
    outDir: fileURLToPath(new URL('../dist/public', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
