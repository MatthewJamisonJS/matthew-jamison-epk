import type { Ctx, Env } from '../types';
import { getActiveAlbum } from '../lib/db';
import { clientIp, corsHeaders, json } from '../lib/http';
import { stripeClient } from '../lib/stripe';

const MAX_BODY_BYTES = 2048;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export async function handleCheckoutPreflight(
  req: Request,
  env: Env,
): Promise<Response> {
  const cors = corsHeaders(env, req);
  if (Object.keys(cors).length === 0) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204, headers: cors });
}

/**
 * POST /checkout  { "slug": "album-slug" }  ->  { "url": "https://checkout.stripe.com/..." }
 *
 * The slug is the ONLY client input that touches money, and it is resolved
 * server-side into a Stripe price id. A `price`, `amount`, or `price_cents`
 * field in the body is not read, not validated, not logged -- it does not
 * exist as far as this handler is concerned. That is the whole defence.
 */
export async function handleCheckout(req: Request, env: Env, _ctx: Ctx): Promise<Response> {
  const cors = corsHeaders(env, req);

  // 1. rate limit, before any work
  const { success } = await env.CHECKOUT_LIMITER.limit({ key: clientIp(req) });
  if (!success) {
    console.warn(JSON.stringify({ level: 'warn', at: 'checkout', outcome: 'rate_limited' }));
    return json({ error: 'rate_limited' }, { status: 429, headers: cors });
  }

  // 2. origin check. Exact match against the one configured origin -- no
  //    prefix matching, no reflected value, no null-origin allowance.
  if (req.headers.get('Origin') !== env.SITE_ORIGIN) {
    return json({ error: 'forbidden' }, { status: 403 });
  }

  // 3. parse. Bounded read: a checkout body is a slug and nothing else.
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: 'bad_request' }, { status: 413, headers: cors });
  }
  let slug: string;
  try {
    const body = JSON.parse(raw) as { slug?: unknown };
    if (typeof body.slug !== 'string' || !SLUG_RE.test(body.slug)) {
      return json({ error: 'bad_request' }, { status: 400, headers: cors });
    }
    slug = body.slug;
  } catch {
    return json({ error: 'bad_request' }, { status: 400, headers: cors });
  }

  // 4. resolve the album -- and therefore the price -- from D1
  const album = await getActiveAlbum(env, slug);
  if (!album) {
    return json({ error: 'not_found' }, { status: 404, headers: cors });
  }

  // 5. create the session
  try {
    const stripe = stripeClient(env);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: album.stripe_price_id, quantity: 1 }],
      // Tax BEHAVIOR (exclusive) is set on the price in Stripe and is
      // irreversible there. This flag only turns calculation on.
      automatic_tax: { enabled: true },
      billing_address_collection: 'auto',
      success_url: `${env.SITE_ORIGIN}/thanks/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.SITE_ORIGIN}/#catalog`,
      // Stripe's own promotional-consent checkbox. Not a custom field: the
      // resulting `consent.promotions` value is the consent record.
      consent_collection: { promotions: 'auto' },
      // On the session AND the payment intent. `line_items` is not included
      // on the session delivered to the webhook, and charge/dispute events
      // only carry the payment intent -- so the slug has to be on both.
      metadata: { album_slug: album.slug },
      payment_intent_data: { metadata: { album_slug: album.slug } },
    });

    if (!session.url) {
      throw new Error('stripe returned a session with no url');
    }

    return json({ url: session.url }, { headers: cors });
  } catch (err) {
    console.error(
      JSON.stringify({ level: 'error', at: 'checkout', slug, err: String(err) }),
    );
    return json({ error: 'checkout_failed' }, { status: 502, headers: cors });
  }
}
