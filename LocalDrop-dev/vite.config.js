import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // OS env (exported by start.sh) wins over .env files
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
      // In dev: empty string → Vite proxy handles /api/* (no CORS issues)
      // In prod build: real URL baked in for standalone deployments
      'import.meta.env.VITE_API_URL': JSON.stringify(
        mode === 'development' ? '' : apiUrl
      ),
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
      // Output goes into ../static/react/ relative to this vite.config.js.
      // That puts it at:  <project_root>/static/react/
      // FastAPI serves from there via the SPA fallback in app.py.
      outDir:      '../static/react',
      emptyOutDir: true,
    },
  };
});
