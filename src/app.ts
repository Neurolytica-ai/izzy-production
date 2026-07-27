/**
 * Express application wiring. Kept separate from server.ts so tests can mount
 * the app without binding a port.
 */
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './lib/config.ts';
import { errorHandler, notFound } from './lib/errors.ts';
import { healthRouter } from './routes/health.ts';

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

  app.use('/api', healthRouter);

  // Phase 1 mounts auth + master data here; Phase 2 reports; Phase 3 import/export.

  app.use('/api', (_req, _res, next) => next(notFound('נתיב API לא קיים')));
  app.use(errorHandler);

  return app;
}
