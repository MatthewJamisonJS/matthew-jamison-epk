import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { claimEvent, HANDLED_EVENT_TYPES, releaseEvent } from '../../src/routes/webhook';

/**
 * Stripe retries on any timeout or non-2xx, and a retry that reruns the work
 * means two emails and a duplicate list row. The claim is written BEFORE any
 * side effect, so exactly one delivery ever gets to act.
 */
describe('webhook event dedupe', () => {
  it('lets the first delivery through', async () => {
    expect(await claimEvent(env, 'evt_first', 'checkout.session.completed')).toBe(true);
  });

  it('refuses the second delivery of the same event id', async () => {
    expect(await claimEvent(env, 'evt_dupe', 'checkout.session.completed')).toBe(true);
    expect(await claimEvent(env, 'evt_dupe', 'checkout.session.completed')).toBe(false);
    expect(await claimEvent(env, 'evt_dupe', 'checkout.session.completed')).toBe(false);
  });

  it('keeps exactly one row per event id', async () => {
    await claimEvent(env, 'evt_once', 'charge.refunded');
    await claimEvent(env, 'evt_once', 'charge.refunded');
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM stripe_events WHERE id = ?1`,
    )
      .bind('evt_once')
      .first<{ n: number }>();
    expect(row!.n).toBe(1);
  });

  it('lets exactly one of many simultaneous deliveries claim the event', async () => {
    const claims = await Promise.all(
      Array.from({ length: 10 }, () => claimEvent(env, 'evt_race', 'checkout.session.completed')),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('records the type and a received_at timestamp, and leaves processed_at null', async () => {
    await claimEvent(env, 'evt_meta', 'charge.dispute.created');
    const row = await env.DB.prepare(
      `SELECT type, received_at, processed_at FROM stripe_events WHERE id = ?1`,
    )
      .bind('evt_meta')
      .first<{ type: string; received_at: string; processed_at: string | null }>();
    expect(row!.type).toBe('charge.dispute.created');
    expect(Number.isNaN(Date.parse(row!.received_at))).toBe(false);
    expect(row!.processed_at).toBeNull();
  });
});

describe('releasing a failed event', () => {
  it('lets a Stripe retry reprocess after a dispatch failure', async () => {
    expect(await claimEvent(env, 'evt_boom', 'checkout.session.completed')).toBe(true);
    await releaseEvent(env, 'evt_boom');
    // Without the release, the retry would be silently swallowed as a
    // duplicate and the customer would never get their album.
    expect(await claimEvent(env, 'evt_boom', 'checkout.session.completed')).toBe(true);
  });

  it('refuses to release an event that already finished processing', async () => {
    await claimEvent(env, 'evt_done', 'checkout.session.completed');
    await env.DB.prepare(`UPDATE stripe_events SET processed_at = ?2 WHERE id = ?1`)
      .bind('evt_done', new Date().toISOString())
      .run();

    await releaseEvent(env, 'evt_done');

    // Still claimed: a completed event must never be replayed.
    expect(await claimEvent(env, 'evt_done', 'checkout.session.completed')).toBe(false);
  });
});

describe('handled event types', () => {
  it('covers the delayed-payment and money-back paths, not just the happy one', () => {
    expect([...HANDLED_EVENT_TYPES].sort()).toEqual([
      'charge.dispute.created',
      'charge.refunded',
      'checkout.session.async_payment_failed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.completed',
      'checkout.session.expired',
    ]);
  });
});
