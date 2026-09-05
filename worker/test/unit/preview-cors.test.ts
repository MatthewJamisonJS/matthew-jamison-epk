import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  handlePreview,
  handlePreviewPreflight,
  handleStreamPreflight,
} from '../../src/routes/preview';

/**
 * CORS on the public /p/ mp3 route.
 *
 * The site player fetches whole 128k files with `fetch(url, { mode: 'cors' })`
 * and stores them in IndexedDB, so an opaque response is useless to it. /s/
 * already carried these headers; /p/ now uses the same helper.
 *
 * The R2 bucket is empty under test, so every GET here is a 404 body. That is
 * deliberate and sufficient: the assertion is about the header layer, which is
 * applied to whatever `serveAudio` returned -- the 404 path included. A 200
 * would need a seeded R2 object and would exercise no extra header code.
 */

const ORIGIN = env.SITE_ORIGIN;
const FOREIGN = 'https://evil.example';
const URL_ = 'https://api.example.com/p/perspective/01';

async function get(origin: string | null) {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = {};
  if (origin) headers.Origin = origin;
  const res = await handlePreview(new Request(URL_, { headers }), env, ctx, {
    slug: 'perspective',
    track: '01',
  });
  await waitOnExecutionContext(ctx);
  return res;
}

const preflight = (origin: string | null) =>
  handlePreviewPreflight(
    new Request(URL_, { method: 'OPTIONS', headers: origin ? { Origin: origin } : {} }),
    env,
  );

describe('GET /p/:slug/:track CORS', () => {
  it('allows the site origin and varies on Origin', async () => {
    const res = await get(ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Vary')?.toLowerCase()).toContain('origin');
  });

  it('sends no ACAO to a foreign origin', async () => {
    const res = await get(FOREIGN);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('sends no ACAO when there is no Origin at all', async () => {
    const res = await get(null);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('OPTIONS /p/:slug/:track', () => {
  it('204s the site origin and allows the Range header', async () => {
    const res = await preflight(ORIGIN);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Range');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
  });

  it('403s a foreign origin', async () => {
    expect((await preflight(FOREIGN)).status).toBe(403);
  });

  // The alias is what index.ts imports for /s/; if it ever stops being the
  // same function the two routes can drift, which is the bug this replaced.
  it('is the same handler the /s/ route preflights with', () => {
    expect(handlePreviewPreflight).toBe(handleStreamPreflight);
  });
});
