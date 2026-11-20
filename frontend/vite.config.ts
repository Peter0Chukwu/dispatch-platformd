import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Compile the shared package from TypeScript source in the browser build.
      // (The NestJS API consumes the compiled dist/ output instead.) This avoids
      // CommonJS interop in Rollup and gives instant HMR when shared schemas change.
      '@dispatch/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The hosted preview serves the app from a proxied hostname, so any host
    // must be accepted in development. Restrict this in production (the SPA is
    // then served as static files by Nginx/Cloudflare).
    allowedHosts: true,
    proxy: {
      // The browser always calls same-origin "/api/..."; Vite forwards to the
      // NestJS API. This keeps cookies same-origin and avoids CORS in dev.
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: false,
      },
      // The live dispatch channel. Same origin as the page, so the HttpOnly
      // refresh cookie travels with the handshake and no CORS rule is needed.
      // `ws: true` lets Vite proxy the WebSocket upgrade, not just the polling
      // fallback — without it the socket silently degrades or never connects.
      '/socket.io': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: false,
        ws: true,
      },
    },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: {
    /**
     * Source maps were ON, which is three costs for one benefit nobody wanted:
     * Rollup spends a large slice of its render phase building them (the phase a
     * small build machine dies in), the build takes longer, and the complete
     * front-end source ships to anyone who opens devtools on the live site.
     */
    sourcemap: false,
    /**
     * Render one file at a time. Rollup holds every in-flight chunk in memory at
     * once; on a builder with 1 GB this is the difference between a finished build
     * and a process that is silently killed.
     */
    rollupOptions: { maxParallelFileOps: 1 },
    outDir: 'dist',
  },
});
