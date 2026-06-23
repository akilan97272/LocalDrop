import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const apiUrl = env.LOCALDROP_API_URL || 'http://localhost:8080';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiUrl,
          changeOrigin: true,
        },
        '/download': {
          target: apiUrl,
          changeOrigin: true,
        },
        '/qr': {
          target: apiUrl,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: '../static',
      emptyOutDir: true,
    },
  };
});