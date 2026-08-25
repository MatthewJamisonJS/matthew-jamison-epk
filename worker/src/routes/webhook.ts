import type Stripe from 'stripe';
import type { Ctx, Env } from '../types';
import { createDownloadToken, getAlbum, intVar, revokeTokensForPurchase } from '../lib/db';
import { alert, drainOutbox, enqueue } from '../lib/outbox';
import { constructEvent, expectedLivemode } from '../lib/stripe';
import { recordConsent } from '../lib/subscribers';
import { isoNow, normalizeEmail } from '../lib/tokens';

/** Types we act on. Everything else is acknowledged and ignored. */
export const HANDLED_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'charge.refunded',
  'charge.dispute.created',
]);

/**
 * POST /webhook
 *
 * The order of the first five steps is load-bearing:
 *   1. raw body -- nothing may parse JSON first or the signature is destroyed
 *   2. constructEventAsync with the SubtleCrypto provider
 *   3. livemode guard -- a test event must never touch live data
 *   4. INSERT OR IGNORE the event id BEFORE any side effect; changes === 0
 *      means a duplicate delivery and we return 200 immediately
 *   5. only then, dispatch
 *
 * Emails are queued, never sent inline: Stripe's delivery window is short and
 * awaiting a provider here turns one slow request into a retry storm.
 */
export async function handleWebhook(req: Request, env: Env, ctx: Ctx): Promise<Response> {
  const started = Date.now();
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('missing signature', { status: 400 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await constructEvent(env, rawBody, signature);
  } catch (err) {
    console.warn(
      JSON.stringify({ level: 'warn', at: 'webhook', outcome: 'bad_signature', err: String(err) }),
    );
    return new Response('invalid signature', { status: 400 });
  }

  if (event.livemode !== expectedLivemode(env)) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        at: 'webhook',
        outcome: 'livemode_mismatch',
        event_id: event.id,
        event_livemode: event.livemode,
        expected: expectedLivemode(env),
      }),
    );
    return new Response('livemode mismatch', { status: 400 });
  }

  const claimed = await claimEvent(env, event.id, event.type);
  if (!claimed) {
    console.log(
      JSON.stringify({
        level: 'info',
        at: 'webhook',
        outcome: 'duplicate',
        event_id: event.id,
        type: event.type,
        ms: Date.now() - started,
      }),
    );
    return new Response('duplicate', { status: 200 });
  }

  try {
    await dispatch(env, event);
  } catch (err) {
    // The dedupe row is released so Stripe's retry actually reprocesses.
    // Leaving it in place would turn one transient D1 error into a silently
    // undelivered album.
    await releaseEvent(env, event.id);
    await alert(
      env,
      'webhook_dispatch_failed',
      `event ${event.id} (${event.type}) threw and was released for retry.\n\n${String(err)}`,
    );
    return new Response('processing failed', { status: 500 });
  }

  await env.DB.prepare(`UPDATE stripe_events SET processed_at = ?2 WHERE id = ?1`)
    .bind(event.id, isoNow())
    .run();

  // Opportunistic send. The ten-minute cron is the actual guarantee.
  ctx.waitUntil(
    drainOutbox(env).catch((err) =>
      console.error(JSON.stringify({ level: 'error', at: 'waitUntil_drain', err: String(err) })),
    ),
  );

  console.log(
    JSON.stringify({
      level: 'info',
      at: 'webhook',
      outcome: 'processed',
      event_id: event.id,
      type: event.type,
      ms: Date.now() - started,
    }),
  );
  return new Response('ok', { status: 200 });
}

/** true when this call is the one that gets to process the event. */
export async function claimEvent(env: Env, id: string, type: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO stripe_events (id, type, received_at, processed_at)
     VALUES (?1, ?2, ?3, NULL)`,
  )
    .bind(id, type, isoNow())
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function releaseEvent(env: Env, id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM stripe_events WHERE id = ?1 AND processed_at IS NULL`)
    .bind(id)
    .run();
}

/**
 * Shared by the webhook and by nightly reconciliation, so a missed delivery
 * is replayed through exactly the same code path.
 */
export async function dispatch(env: Env, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.payment_status === 'paid') {
        await fulfill(env, session);
      } else {
        // ACH and other delayed methods land here first. Record it, deliver
        // nothing, and wait for async_payment_succeeded.
        await upsertPurchase(env, session, 'unpaid');
        console.log(
          JSON.stringify({
            level: 'info',
            at: 'webhook',
            outcome: 'awaiting_async_payment',
            session: session.id,
          }),
        );
      }
      break;
    }

    case 'checkout.session.async_payment_succeeded':
      await fulfill(env, event.data.object);
      break;

    case 'checkout.session.async_payment_failed': {
      const session = event.data.object;
      await upsertPurchase(env, session, 'failed');
      await env.DB.prepare(`UPDATE purchases SET status = 'failed' WHERE id = ?1`)
        .bind(session.id)
        .run();
      const email = normalizeEmail(session.customer_details?.email ?? '');
      const slug = slugOf(session.metadata);
      if (email) {
        const album = slug ? await getAlbum(env, slug) : null;
        await enqueue(env, email, 'payment_failed', {
          album_title: album?.title ?? slug ?? 'your order',
        });
      }
      break;
    }

    case 'checkout.session.expired':
      console.log(
        JSON.stringify({
          level: 'info',
          at: 'webhook',
          outcome: 'session_expired',
          session: event.data.object.id,
        }),
      );
      break;

    case 'charge.refunded':
      await revokeByPaymentIntent(env, event.data.object.payment_intent, 'refunded');
      break;

    case 'charge.dispute.created':
      await revokeByPaymentIntent(env, event.data.object.payment_intent, 'disputed');
      break;

    default:
      // 200, no-op. Stripe sends plenty we did not subscribe to.
      break;
  }
}

/* ------------------------------------------------------------------ */

function slugOf(metadata: Stripe.Metadata | null | undefined): string | null {
  const raw = metadata?.album_slug;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : v.id;
}

async function upsertPurchase(
  env: Env,
  session: Stripe.Checkout.Session,
  status: 'paid' | 'unpaid' | 'failed',
): Promise<void> {
  const email = normalizeEmail(session.customer_details?.email ?? '');
  const slug = slugOf(session.metadata);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO purchases
       (id, payment_intent_id, email, album_slug, amount_total_cents, tax_cents,
        currency, country, status, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  )
    .bind(
      session.id,
      idOf(session.payment_intent),
      email || '(missing)',
      slug ?? '(unknown)',
      session.amount_total ?? 0,
      session.total_details?.amount_tax ?? 0,
      session.currency ?? 'usd',
      session.customer_details?.address?.country ?? null,
      status,
      isoNow(),
    )
    .run();
}

/**
 * Idempotent. Safe to run twice for the same session: the purchase insert is
 * INSERT OR IGNORE, and a second token is never minted because we check for
 * an existing one first.
 */
async function fulfill(env: Env, session: Stripe.Checkout.Session): Promise<void> {
  await upsertPurchase(env, session, 'paid');
  await env.DB.prepare(
    `UPDATE purchases SET status = 'paid', payment_intent_id = COALESCE(payment_intent_id, ?2)
      WHERE id = ?1 AND status IN ('unpaid', 'failed')`,
  )
    .bind(session.id, idOf(session.payment_intent))
    .run();

  const email = normalizeEmail(session.customer_details?.email ?? '');
  const slug = slugOf(session.metadata);
  const country = session.customer_details?.address?.country ?? null;

  if (!slug) {
    await alert(
      env,
      'missing_album_slug',
      `session ${session.id} paid ${session.amount_total} ${session.currency} but carries no metadata.album_slug. ` +
        `Purchase row written; NOTHING was delivered. Fulfil manually and fix the Product metadata.`,
    );
    return;
  }

  const album = await getAlbum(env, slug);
  if (!album) {
    await alert(
      env,
      'unknown_album_slug',
      `session ${session.id} references album_slug "${slug}" which is not in the albums table. ` +
        `Purchase row written; NOTHING was delivered. Seed the album, then reissue a token.`,
    );
    return;
  }

  if (!email) {
    await alert(
      env,
      'missing_customer_email',
      `session ${session.id} for "${slug}" has no customer email. Cannot deliver.`,
    );
    return;
  }

  // One token per purchase, minted once.
  const existing = await env.DB.prepare(
    `SELECT token FROM download_tokens WHERE purchase_id = ?1 LIMIT 1`,
  )
    .bind(session.id)
    .first<{ token: string }>();

  if (!existing) {
    const token = await createDownloadToken(env, session.id, slug);
    await enqueue(env, email, 'download_ready', {
      token,
      album_title: album.title,
      album_slug: slug,
      // The delivery email describes what is on the page, and that differs for
      // a pack (one zip) and a bundle (two packs).
      album_kind: album.kind,
      ttl_hours: intVar(env.DOWNLOAD_TTL_HOURS, 72),
      max_downloads: intVar(env.MAX_DOWNLOADS, 5),
    });
  }

  // Consent is a SEPARATE decision from delivery. The album ships either way.
  if (session.consent?.promotions === 'opt_in') {
    await recordConsent(env, email, slug, country);
  }
}

async function revokeByPaymentIntent(
  env: Env,
  paymentIntent: string | Stripe.PaymentIntent | null,
  status: 'refunded' | 'disputed',
): Promise<void> {
  const pi = idOf(paymentIntent);
  if (!pi) {
    await alert(env, `${status}_without_payment_intent`, `charge event carried no payment intent`);
    return;
  }

  const { results } = await env.DB.prepare(
    `SELECT id FROM purchases WHERE payment_intent_id = ?1`,
  )
    .bind(pi)
    .all<{ id: string }>();

  if (results.length === 0) {
    await alert(
      env,
      `${status}_unknown_purchase`,
      `no purchase row matches payment_intent ${pi}; nothing to revoke`,
    );
    return;
  }

  for (const row of results) {
    await env.DB.prepare(`UPDATE purchases SET status = ?2 WHERE id = ?1`)
      .bind(row.id, status)
      .run();
    const revoked = await revokeTokensForPurchase(env, row.id);
    console.log(
      JSON.stringify({
        level: 'info',
        at: 'webhook',
        outcome: status,
        purchase: row.id,
        tokens_revoked: revoked,
      }),
    );
  }
}
