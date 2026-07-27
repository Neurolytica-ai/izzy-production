/**
 * Boots the Express app in-process on an ephemeral port and exercises the
 * endpoints that must work before anything is deployed.
 *
 *   npm run smoke
 *
 * Runs without a reachable database on purpose: /api/health must stay up and
 * /api/ready must report 503 rather than crashing the process. That is the
 * behaviour that matters when Supabase blips.
 */
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function checkTrue(label: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`);
  }
}

async function main() {
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  console.log(`app listening on ${base}\n`);

  try {
    console.log('Health:');
    const health = await fetch(`${base}/api/health`);
    check('GET /api/health -> 200', health.status, 200);
    const healthBody = (await health.json()) as { ok: boolean; uptimeSeconds: number };
    check('  body.ok', healthBody.ok, true);
    checkTrue('  body.uptimeSeconds is a number', typeof healthBody.uptimeSeconds === 'number');

    console.log('\nReadiness with no database:');
    const ready = await fetch(`${base}/api/ready`);
    check('GET /api/ready -> 503 (not a crash)', ready.status, 503);
    const readyBody = (await ready.json()) as { ok: boolean; database: { ok: boolean; error?: string } };
    check('  body.ok', readyBody.ok, false);
    check('  body.database.ok', readyBody.database.ok, false);
    checkTrue('  body.database.error explains why', typeof readyBody.database.error === 'string' && readyBody.database.error.length > 0);

    console.log('\nError shape:');
    const missing = await fetch(`${base}/api/does-not-exist`);
    check('unknown /api route -> 404', missing.status, 404);
    const missingBody = (await missing.json()) as { error: string; message: string };
    check('  body.error', missingBody.error, 'not_found');
    checkTrue('  body.message is Hebrew user-facing text', /[֐-׿]/.test(missingBody.message));

    console.log('\nSecurity headers:');
    checkTrue('x-powered-by is not advertised', health.headers.get('x-powered-by') === null);
    checkTrue(
      'helmet is applied (x-content-type-options)',
      health.headers.get('x-content-type-options') === 'nosniff'
    );

    console.log('\nMalformed request handling:');
    const tooBig = await fetch(`${base}/api/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) }),
    });
    check('a 2MB body -> 413, not 500', tooBig.status, 413);
    const tooBigBody = (await tooBig.json()) as { error: string; message: string };
    check('  body.error', tooBigBody.error, 'entity.too.large');
    checkTrue('  body.message is Hebrew user-facing text', /[֐-׿]/.test(tooBigBody.message));

    const badJson = await fetch(`${base}/api/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not valid json',
    });
    check('malformed JSON -> 400, not 500', badJson.status, 400);
    const badJsonBody = (await badJson.json()) as { error: string };
    check('  body.error', badJsonBody.error, 'entity.parse.failed');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log(`\n${'='.repeat(56)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('smoke failed:', err);
  process.exit(1);
});
