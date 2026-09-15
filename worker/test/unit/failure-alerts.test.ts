import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetCheckoutAlertThrottle, handleCheckout } from '../../src/routes/checkout';
import { nightly } from '../../src/scheduled';

/**
 * The restricted Stripe key expired once and nobody found out for days: every
 * /checkout 502'd and every nightly reconcile() died, and both paths only
 * wrote a console line. These tests pin the alert, and they pin the throttle
 * that keeps the alert from becoming the outage's own amplifier.
 *
 * Stripe is failed at the wire rather than by stubbing the SDK -- a 401 off
 * api.stripe.com is exactly what a dead key produces, and the SDK's own error
 * (masked key included) is what ends up in the mail.
 */

const SLUG = 'example-album';
const STRIPE_401 = JSON.stringify({
  error: { type: 'invalid_request_error', message: 'Expired API Key provided: rk_live_***' },
});

/**
 * Stripe's fetch client captures globalThis.fetch when stripeClient() runs, and
 * that is inside the handler -- so stubbing the global here is enough. The
 * pool has no fetchMock export, hence the hand-rolled stub.
 */
let stripeCalls = 0;
function failStripe() {
  stripeCalls = 0;
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://api.stripe.com/')) {
      stripeCalls++;
      return Promise.resolve(
        new Response(STRIPE_401, {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return real(input as RequestInfo, init);
  });
}

async function postCheckout(ip: string): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await handleCheckout(
    new Request('https://api.matthewjamison.dev/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: env.SITE_ORIGIN,
        'CF-Connecting-IP': ip,
      },
      body: JSON.stringify({ slug: SLUG }),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function alertRows(): Promise<{ kind: string; detail: string; to: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT to_email, payload_json FROM email_outbox
      WHERE template = 'alert' ORDER BY created_at, id`,
  ).all<{ to_email: string; payload_json: string }>();
  return results.map((r) => {
    const p = JSON.parse(r.payload_json) as { kind: string; detail: string };
    return { kind: p.kind, detail: p.detail, to: r.to_email };
  });
}

// The pool runs every file against one worker, so the key is put back after.
let realKey: string;

beforeAll(async () => {
  // A real key shape: the handler has to get as far as the network to fail there.
  realKey = env.STRIPE_SECRET_KEY;
  env.STRIPE_SECRET_KEY = 'rk_live_alerts_test';
  await env.DB.prepare(
    `INSERT OR REPLACE INTO albums
       (slug, title, kind, price_cents, stripe_price_id, r2_key_wav, r2_key_mp3, active)
     VALUES (?1, 'Example Album', 'album', 999, 'price_example', 'a/w.zip', 'a/m.zip', 1)`,
  )
    .bind(SLUG)
    .run();
});

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM email_outbox`).run();
  _resetCheckoutAlertThrottle();
  failStripe();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  env.STRIPE_SECRET_KEY = realKey;
});

describe('checkout tells somebody when Stripe refuses', () => {
  it('502s and queues exactly one checkout_failed alert naming the slug', async () => {
    const res = await postCheckout('203.0.113.11');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'checkout_failed' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(env.SITE_ORIGIN);
    expect(stripeCalls).toBeGreaterThan(0);

    const rows = await alertRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('checkout_failed');
    expect(rows[0]!.to).toBe(env.ALERT_EMAIL);
    expect(rows[0]!.detail).toContain(SLUG);
    expect(rows[0]!.detail).toContain('Expired API Key');
    // Stripe masks the key in its own message, so passing that message through
    // cannot leak it.
    expect(rows[0]!.detail).not.toContain('rk_live_alerts_test');
  });

  it('does not queue a second alert for the next failure in the same hour', async () => {
    expect((await postCheckout('203.0.113.12')).status).toBe(502);
    expect((await postCheckout('203.0.113.13')).status).toBe(502);

    // Two outages reported to the console, one email.
    expect(await alertRows()).toHaveLength(1);
  });

  it('queues again once the window has passed', async () => {
    expect((await postCheckout('203.0.113.14')).status).toBe(502);
    _resetCheckoutAlertThrottle(); // stands in for the hour elapsing
    expect((await postCheckout('203.0.113.15')).status).toBe(502);

    expect((await alertRows()).map((r) => r.kind)).toEqual([
      'checkout_failed',
      'checkout_failed',
    ]);
  });
});

describe('the nightly cron tells somebody when reconciliation dies', () => {
  it('queues one reconcile_failed alert and still finishes the rest of the run', async () => {
    await nightly(env);

    const rows = await alertRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('reconcile_failed');
    expect(rows[0]!.detail).toContain('Expired API Key');

    // The backup still ran: a broken Stripe must not also cost us the snapshot.
    const listed = await env.ALBUMS.list({ prefix: 'backups/' });
    expect(listed.objects.length).toBeGreaterThan(0);
  });
});
