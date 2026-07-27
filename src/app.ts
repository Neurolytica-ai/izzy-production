/**
 * Express application wiring. Kept separate from server.ts so tests can mount
 * the app without binding a port.
 */
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './lib/config.ts';
import { errorHandler, notFound } from './lib/errors.ts';
import { requireAuth } from './middleware/auth.ts';
import { healthRouter } from './routes/health.ts';
import { authRouter } from './routes/auth.ts';
import { usersRouter } from './routes/users.ts';
import { masterRouter } from './routes/master.ts';
import { lookupRouter } from './routes/lookup.ts';
import { metaRouter } from './routes/meta.ts';

export function createApp() {
  const app = express();

  // Behind Nginx, so trust the proxy for req.ip / req.protocol.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The front end is served from the same origin as the API and currently
      // loads SheetJS from a CDN. Phase 3 moves XLSX parsing server-side, at
      // which point this can tighten to 'self' with no CDN allowance.
      contentSecurityPolicy: false,
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  if (config.CORS_ORIGINS.length > 0) {
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && config.CORS_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  // Public: health checks and login.
  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);

  // Everything below requires a session. WP §8: permissions are enforced on the
  // server for every endpoint, never by hiding a button.
  app.use('/api/users', requireAuth, usersRouter);
  app.use('/api/lookup', requireAuth, lookupRouter);
  app.use('/api/meta', requireAuth, metaRouter);
  app.use('/api', requireAuth, masterRouter);

  // Phase 2 mounts reports/attendance/dashboard; Phase 3 import/export.

  app.use('/api', (_req, _res, next) => next(notFound('error.apiRouteMissing')));
  app.use(errorHandler);

  return app;
}
