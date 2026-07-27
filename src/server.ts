/**
 * HTTP entry point.
 */
import { createApp } from './app.ts';
import { config } from './lib/config.ts';
import { closePool, healthCheck } from './lib/db.ts';

const app = createApp();

const server = app.listen(config.PORT, () => {
  console.log(
    `[server] Izzy Yogev production system listening on :${config.PORT} (${config.NODE_ENV})`
  );
});

// Report database reachability at boot without refusing to start — the app
// staying up with a clear error beats a crash loop when Supabase is briefly
// unreachable.
void healthCheck().then((db) => {
  console.log(
    db.ok
      ? `[server] database ok (${db.latencyMs.toFixed(0)}ms)`
      : `[server] WARNING: database unreachable — ${db.error}`
  );
});

async function shutdown(signal: string) {
  console.log(`[server] ${signal} received, shutting down`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
