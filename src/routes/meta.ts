/**
 * Front-end metadata: the active language and the display labels for the codes
 * stored in activity_log.
 *
 * Without this the client would have to hardcode a translation table for action
 * and entity codes, which is exactly the duplication that makes a language switch
 * expensive. The server owns the vocabulary; the client renders what it is given.
 */
import { Router } from 'express';
import { config } from '../lib/config.ts';
import { vocabulary } from '../lib/messages.ts';

export const metaRouter = Router();

metaRouter.get('/vocabulary', (_req, res) => {
  // Safe to cache for a while: it only changes on deploy.
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.json({ data: vocabulary() });
});

metaRouter.get('/config', (_req, res) => {
  // Deliberately narrow — the client needs presentation hints, nothing else.
  // No secrets, no connection strings, no role logic.
  res.json({
    data: {
      lang: config.UI_LANG,
      dir: config.UI_LANG === 'he' ? 'rtl' : 'ltr',
      sessionTtlHours: config.SESSION_TTL_HOURS,
    },
  });
});
