import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };

  const port   = parseInt(env.LOCALDROP_PORT || '5000', 10);
  const apiUrl = env.LOCALDROP_API_URL || `http://127.0.0.1:${port}`;

  console.log(`[localdrop] backend → ${apiUrl}  (mode: ${mode})`);

  const proxyTarget = {
    target:       apiUrl,
    changeOrigin: true,
    secure:       false,
    configure: (proxy) => {
      proxy.on('error', (err, req, res) => {
        console.error(`[proxy] ${req.method} ${req.url} — ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Backend unreachable — is FastAPI running?' }));
        }
      });
    },
  };

  return {
    plugins: [react()],

    define: {
      // ALWAYS bake in '' for both dev and prod.
      // In dev:  Vite proxy rewrites /api/* → backend (no CORS, no CSP issues)
      // In prod: FastAPI serves the built files, so /api/* is same-origin
      //          → browser never makes a cross-origin request
      //          → CSP connect-src 'self' covers everything
      'import.meta.env.VITE_API_URL': JSON.stringify(''),
    },

    server: {
      port: 5173,
      proxy: {
        '/api':      proxyTarget,
        '/download': proxyTarget,
        '/health':   proxyTarget,
      },
    },

    build: {
      outDir:      '../static',
      emptyOutDir: true,
    },
  };
});
