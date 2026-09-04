import type { ConsentSource, Env, SubscriberRow } from '../types';
import { intVar } from './db';
import { enqueue } from './outbox';
import { isoIn, isoNow, newToken } from './tokens';

/**
 * Double opt-in state machine.
 *
 *   [no row] --consent at checkout--> pending --/verify--> confirmed
 *                                       |                     |
 *                                7d, no click            /unsubscribe
 *                                       v                     v
 *                             (stays pending, never    unsubscribed
 *                              emailed marketing)            |
 *                                                     new purchase WITH
 *                                                     fresh consent
 *                                                            v
 *                                                         pending
 *
 * The rules that are easy to get wrong, all enforced below:
 *  - only `confirmed` may ever receive marketing
 *  - `pending` receives exactly one verification email and nothing else, ever
 *  - a repeat purchase never resends verification
 *  - an unsubscribe is NOT undone by a purchase; it takes fresh consent
 *  - the transactional download email is sent regardless of any of this
 */

export async function getSubscriber(env: Env, email: string): Promise<SubscriberRow | null> {
  return env.DB.prepare(`SELECT * FROM subscribers WHERE email = ?1`)
    .bind(email)
    .first<SubscriberRow>();
}

export async function getByVerifyToken(env: Env, token: string): Promise<SubscriberRow | null> {
  return env.DB.prepare(`SELECT * FROM subscribers WHERE verify_token = ?1`)
    .bind(token)
    .first<SubscriberRow>();
}

export async function getByUnsubscribeToken(
  env: Env,
  token: string,
): Promise<SubscriberRow | null> {
  return env.DB.prepare(`SELECT * FROM subscribers WHERE unsubscribe_token = ?1`)
    .bind(token)
    .first<SubscriberRow>();
}

export function verifyTtlMs(env: Env): number {
  return intVar(env.VERIFY_TTL_DAYS, 7) * 86_400_000;
}

export function isVerifyExpired(row: SubscriberRow): boolean {
  if (!row.verify_expires_at) return true;
  return Date.parse(row.verify_expires_at) <= Date.now();
}

/**
 * Called from webhook fulfilment when, and only when,
 * `session.consent.promotions === 'opt_in'`, and from POST /subscribe with
 * `source = 'site'`.
 *
 * The source only ever labels the row. Every state transition below is the
 * same whichever door the consent came through -- that is deliberate: a site
 * signup and a checkout tick are the same promise and must not diverge.
 */
export async function recordConsent(
  env: Env,
  email: string,
  albumSlug: string | null,
  country: string | null,
  source: ConsentSource = 'checkout',
): Promise<'created' | 'reopened' | 'unchanged'> {
  const existing = await getSubscriber(env, email);
  const now = isoNow();

  if (!existing) {
    const verifyToken = newToken();
    const unsubToken = newToken();
    await env.DB.prepare(
      `INSERT INTO subscribers
         (email, status, consent_source, consent_at, verify_token, verify_sent_at,
          verify_expires_at, confirmed_at, unsubscribed_at, unsubscribe_token,
          first_album_slug, consent_ip_country)
       VALUES (?1, 'pending', ?8, ?2, ?3, ?2, ?4, NULL, NULL, ?5, ?6, ?7)`,
    )
      .bind(email, now, verifyToken, isoIn(verifyTtlMs(env)), unsubToken, albumSlug, country, source)
      .run();

    await enqueue(env, email, 'verify_subscription', {
      verify_token: verifyToken,
      unsubscribe_token: unsubToken,
      ttl_days: intVar(env.VERIFY_TTL_DAYS, 7),
    });
    return 'created';
  }

  if (existing.status === 'unsubscribed') {
    // Fresh consent on a new checkout is the ONLY way back in.
    const verifyToken = newToken();
    await env.DB.prepare(
      `UPDATE subscribers
          SET status = 'pending', consent_at = ?2, verify_token = ?3,
              verify_sent_at = ?2, verify_expires_at = ?4,
              unsubscribed_at = NULL, confirmed_at = NULL,
              consent_ip_country = COALESCE(?5, consent_ip_country),
              first_album_slug = COALESCE(first_album_slug, ?6)
        WHERE email = ?1`,
    )
      .bind(email, now, verifyToken, isoIn(verifyTtlMs(env)), country, albumSlug)
      .run();

    await enqueue(env, email, 'verify_subscription', {
      verify_token: verifyToken,
      unsubscribe_token: existing.unsubscribe_token,
      ttl_days: intVar(env.VERIFY_TTL_DAYS, 7),
    });
    return 'reopened';
  }

  // pending / confirmed / bounced: record the association, send nothing.
  // A second verification email is exactly the thing double opt-in is meant
  // to avoid, and a bounced address must not be re-mailed at all.
  await env.DB.prepare(
    `UPDATE subscribers
        SET first_album_slug = COALESCE(first_album_slug, ?2),
            consent_ip_country = COALESCE(consent_ip_country, ?3)
      WHERE email = ?1`,
  )
    .bind(email, albumSlug, country)
    .run();
  return 'unchanged';
}

export async function confirmSubscriber(env: Env, email: string): Promise<void> {
  // verify_token is deliberately NOT cleared: a second click on the same link
  // must land on "already confirmed", not on a generic 404.
  await env.DB.prepare(
    `UPDATE subscribers
        SET status = 'confirmed', confirmed_at = ?2, unsubscribed_at = NULL
      WHERE email = ?1 AND status = 'pending'`,
  )
    .bind(email, isoNow())
    .run();
}

export async function reissueVerify(env: Env, email: string): Promise<void> {
  const verifyToken = newToken();
  const row = await getSubscriber(env, email);
  if (!row || row.status !== 'pending') return;
  await env.DB.prepare(
    `UPDATE subscribers
        SET verify_token = ?2, verify_sent_at = ?3, verify_expires_at = ?4
      WHERE email = ?1 AND status = 'pending'`,
  )
    .bind(email, verifyToken, isoNow(), isoIn(verifyTtlMs(env)))
    .run();

  await enqueue(env, email, 'verify_subscription', {
    verify_token: verifyToken,
    unsubscribe_token: row.unsubscribe_token,
    ttl_days: intVar(env.VERIFY_TTL_DAYS, 7),
  });
}

export async function unsubscribe(env: Env, email: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE subscribers
        SET status = 'unsubscribed', unsubscribed_at = ?2
      WHERE email = ?1 AND status != 'unsubscribed'`,
  )
    .bind(email, isoNow())
    .run();
}
