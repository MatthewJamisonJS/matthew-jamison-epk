import type Stripe from 'stripe';
import type { Env } from './types';
import { alert, drainOutbox } from './lib/outbox';
import { stripeClient } from './lib/stripe';
import { isoNow } from './lib/tokens';
import { dispatch, HANDLED_EVENT_TYPES } from './routes/webhook';

export const NIGHTLY_CRON = '0 3 * * *';
export const DRAIN_CRON = '*/10 * * * *';

export async function scheduled(
  event: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  if (event.cron === NIGHTLY_CRON) {
    ctx.waitUntil(nightly(env));
    return;
  }
  // Everything else, including `wrangler dev --test-scheduled` with no cron
  // string, drains the outbox. Draining twice is harmless; not draining is not.
  ctx.waitUntil(
    drainOutbox(env).then((r) =>
      console.log(JSON.stringify({ level: 'info', at: 'cron_drain', ...r })),
    ),
  );
}

export async function nightly(env: Env): Promise<void> {
  const started = Date.now();
  const report: Record<string, unknown> = { at: 'nightly' };

  report.reconciled = await reconcile(env).catch((err) => {
    console.error(JSON.stringify({ level: 'error', at: 'reconcile', err: String(err) }));
    return { error: String(err) };
  });

  report.stale_pending = await countStalePending(env).catch(() => -1);
  report.tokens_pruned = await pruneOldTokens(env).catch(() => -1);
  report.backup = await backupToR2(env).catch((err) => {
    console.error(JSON.stringify({ level: 'error', at: 'backup', err: String(err) }));
    return null;
  });

  report.ms = Date.now() - started;
  console.log(JSON.stringify({ level: 'info', ...report }));
}

/* ------------------------------------------------------------------ */
/* 1. reconciliation                                                   */
/* ------------------------------------------------------------------ */

/**
 * Webhooks fail for reasons outside this code: an endpoint disabled by
 * accident, a deploy landing mid-delivery, a Stripe-side incident. Listing
 * the last 48h of events and diffing against `stripe_events` is cheap
 * insurance, and replaying goes through the SAME dispatch() the live webhook
 * uses -- so a reconciled event cannot behave differently from a delivered one.
 */
export async function reconcile(env: Env): Promise<{ scanned: number; replayed: number }> {
  const stripe = stripeClient(env);
  const since = Math.floor((Date.now() - 48 * 3600_000) / 1000);

  let scanned = 0;
  let replayed = 0;
  let startingAfter: string | undefined;

  // Capped at 10 pages (1000 events). A backlog bigger than that is itself
  // the alert, and a cron invocation must not run unbounded.
  for (let pageNum = 0; pageNum < 10; pageNum++) {
    const page: Stripe.ApiList<Stripe.Event> = await stripe.events.list({
      created: { gte: since },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const event of page.data) {
      scanned++;
      if (!HANDLED_EVENT_TYPES.has(event.type)) continue;
      if (event.livemode !== (env.STRIPE_LIVEMODE === 'true')) continue;

      const claim = await env.DB.prepare(
        `INSERT OR IGNORE INTO stripe_events (id, type, received_at, processed_at)
         VALUES (?1, ?2, ?3, NULL)`,
      )
        .bind(event.id, event.type, isoNow())
        .run();

      if ((claim.meta.changes ?? 0) === 0) continue; // already seen

      try {
        await dispatch(env, event);
        await env.DB.prepare(`UPDATE stripe_events SET processed_at = ?2 WHERE id = ?1`)
          .bind(event.id, isoNow())
          .run();
        replayed++;
      } catch (err) {
        await env.DB.prepare(`DELETE FROM stripe_events WHERE id = ?1 AND processed_at IS NULL`)
          .bind(event.id)
          .run();
        await alert(
          env,
          'reconcile_replay_failed',
          `event ${event.id} (${event.type}) failed during reconciliation.\n\n${String(err)}`,
        );
      }
    }

    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) break;
  }

  if (replayed > 0) {
    await alert(
      env,
      'reconciliation_gap',
      `nightly reconciliation replayed ${replayed} event(s) that never arrived by webhook ` +
        `(out of ${scanned} scanned in the last 48h). Check the Stripe endpoint's delivery log.`,
    );
  }

  // Drain whatever the replay queued, immediately.
  await drainOutbox(env);
  return { scanned, replayed };
}

/* ------------------------------------------------------------------ */
/* 2. stale pending subscribers                                        */
/* ------------------------------------------------------------------ */

/**
 * Counted, NOT mutated.
 *
 * The spec calls this "expire stale pending subscribers", but the state
 * machine says an expired row stays `pending` forever and simply never
 * receives marketing -- and the expired-link page still needs the row's
 * verify_token to offer a new one. So there is nothing to write. What is
 * useful is the number: a climbing count means the confirmation email is
 * landing in spam.
 */
export async function countStalePending(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM subscribers
      WHERE status = 'pending'
        AND verify_expires_at IS NOT NULL
        AND datetime(verify_expires_at) <= datetime('now')`,
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/* 3. prune long-dead tokens                                           */
/* ------------------------------------------------------------------ */

export async function pruneOldTokens(env: Env): Promise<number> {
  // download_events rows are kept: they are the audit trail, and they are the
  // only record left once the token itself is gone.
  const res = await env.DB.prepare(
    `DELETE FROM download_tokens
      WHERE datetime(expires_at) < datetime('now', '-90 days')`,
  ).run();
  return res.meta.changes ?? 0;
}

/* ------------------------------------------------------------------ */
/* 4. backup                                                           */
/* ------------------------------------------------------------------ */

const BACKUP_TABLES = [
  'albums',
  'purchases',
  'download_tokens',
  'subscribers',
  'email_outbox',
  'export_log',
] as const;
const BACKUP_ROW_CAP = 50_000;

/**
 * A JSON snapshot into R2 under `backups/`.
 *
 * NOT a substitute for `wrangler d1 export`: that is the real, restorable
 * dump and it pauses reads and writes while it runs, which is exactly why it
 * belongs in a human-run ops command rather than in a cron. This snapshot is
 * the cheap daily copy that answers "what did that row say last Tuesday".
 */
export async function backupToR2(env: Env): Promise<string> {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    // Table names come from the frozen list above, never from a request.
    const { results } = await env.DB.prepare(`SELECT * FROM ${table} LIMIT ${BACKUP_ROW_CAP}`).all();
    snapshot[table] = results;
  }
  const key = `backups/mj-music-${isoNow().slice(0, 10)}.json`;
  await env.ALBUMS.put(key, JSON.stringify({ taken_at: isoNow(), tables: snapshot }), {
    httpMetadata: { contentType: 'application/json' },
  });
  return key;
}
