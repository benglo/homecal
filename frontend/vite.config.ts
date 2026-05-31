import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend dev server (for API proxy during `npm run dev:frontend`).
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:8787';

const buildId = process.env.BUILD_ID ?? Date.now().toString(36);

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  server: {
    host: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
