import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy all /api, /download, /qr calls to Flask
      '/api':      { target: 'http://localhost:8080', changeOrigin: true },
      '/download': { target: 'http://localhost:8080', changeOrigin: true },
      '/qr':       { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: '../static/react',   // Flask can serve from /static/react
    emptyOutDir: true,
  },
});
