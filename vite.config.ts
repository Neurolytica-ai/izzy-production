import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Front-end build.
 *
 * Output goes to public/, which is what Nginx serves as the site root (see
 * nginx/default.conf). Hashed assets land in public/assets/ so the long
 * cache-control header there is safe.
 */
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Same-origin in production (Nginx proxies /api), so proxy in dev too —
    // that keeps the session cookie first-party and means no CORS config and no
    // difference in cookie behaviour between dev and production.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
});
