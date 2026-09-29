import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Short commit hash of the checkout being built, for the version badge in the
 * header. Uses git when it is installed; the Docker build image has no git, so
 * it falls back to reading .git/HEAD and the ref file directly. Empty string if
 * neither works (the badge then shows version + build time only).
 */
function gitCommit(): string {
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    try {
      const head = readFileSync('.git/HEAD', 'utf8').trim();
      if (!head.startsWith('ref: ')) return head.slice(0, 7);
      const ref = head.slice(5);
      if (existsSync(`.git/${ref}`)) return readFileSync(`.git/${ref}`, 'utf8').trim().slice(0, 7);
      const packed = existsSync('.git/packed-refs') ? readFileSync('.git/packed-refs', 'utf8') : '';
      const line = packed.split('\n').find((l) => l.endsWith(` ${ref}`));
      return line ? line.slice(0, 7) : '';
    } catch {
      return '';
    }
  }
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

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
  // Shown in the header so the client can tell a deploy has reached them.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(gitCommit()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString()),
  },
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
