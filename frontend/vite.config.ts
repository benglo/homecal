import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend dev server (for API proxy during `npm run dev:frontend`).
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // expose dev server on the LAN too
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
