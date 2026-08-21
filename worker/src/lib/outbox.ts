import type { Env } from '../types';
import { render, sendEmail, type TemplateName } from './email';
import { isoNow, newId } from './tokens';

/**
 * Durable email queue in D1. Deliberately not Cloudflare Queues:
 *  - Stripe's webhook delivery window is short, and awaiting a provider call
 *    inside the handler turns a slow provider into a retry storm.
 *  - the same table doubles as the audit trail when a customer says they got
 *    nothing, which a queue does not give you.
 *
 * webhook       -> INSERT pending -> ctx.waitUntil(drainOutbox())  (opportunistic)
 * ten-minute cron -> drainOutbox()                                 (the guarantee)
 */

/**
 * 1m, 5m, 30m, 2h, 12h. MAX_ATTEMPTS is 5, so the first four are the ones
 * actually waited on -- the fifth failure marks the row `failed` rather than
 * scheduling the 12h retry. The value is kept so raising MAX_ATTEMPTS is a
 * one-character change.
 */
export const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
export const MAX_ATTEMPTS = 5;
export const DRAIN_BATCH = 20;

/** Wait before the retry that follows failure number `attempts` (1-based). */
export function backoffMs(attempts: number): number {
  const i = Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[i]!;
}

export function isExhausted(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

export async function enqueue(
  env: Env,
  toEmail: string,
  template: TemplateName,
  payload: Record<string, unknown>,
): Promise<string> {
  const id = newId('om');
  const now = isoNow();
  await env.DB.prepare(
    `INSERT INTO email_outbox
       (id, to_email, template, payload_json, status, attempts,
        last_error, next_attempt_at, created_at, sent_at)
     VALUES (?1, ?2, ?3, ?4, 'pending', 0, NULL, ?5, ?5, NULL)`,
  )
    .bind(id, toEmail, template, JSON.stringify(payload), now)
    .run();
  return id;
}

/** Operator alert. Goes through the same machinery so it is durable too. */
export async function alert(
  env: Env,
  kind: string,
  detail: string,
): Promise<void> {
  try {
    console.error(JSON.stringify({ level: 'alert', kind, detail }));
    await enqueue(env, env.ALERT_EMAIL, 'alert', { kind, detail });
  } catch (err) {
    // An alert that cannot be queued must not take down the request that was
    // trying to report a problem. The console line above is the fallback.
    console.error(JSON.stringify({ level: 'error', at: 'alert', err: String(err) }));
  }
}

interface OutboxRow {
  id: string;
  to_email: string;
  template: string;
  payload_json: string;
  attempts: number;
}

export interface DrainResult {
  picked: number;
  sent: number;
  retried: number;
  failed: number;
}

export async function drainOutbox(env: Env, limit = DRAIN_BATCH): Promise<DrainResult> {
  const { results } = await env.DB.prepare(
    `SELECT id, to_email, template, payload_json, attempts
       FROM email_outbox
      WHERE status = 'pending' AND datetime(next_attempt_at) <= datetime('now')
      ORDER BY next_attempt_at ASC
      LIMIT ?1`,
  )
    .bind(limit)
    .all<OutboxRow>();

  const out: DrainResult = { picked: results.length, sent: 0, retried: 0, failed: 0 };

  for (const row of results) {
    try {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const rendered = render(env, row.template as TemplateName, payload);
      await sendEmail(env, row.to_email, rendered);
      await env.DB.prepare(
        `UPDATE email_outbox SET status = 'sent', sent_at = ?2, last_error = NULL
          WHERE id = ?1`,
      )
        .bind(row.id, isoNow())
        .run();
      out.sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const message = String(err).slice(0, 500);
      if (isExhausted(attempts)) {
        await env.DB.prepare(
          `UPDATE email_outbox
              SET status = 'failed', attempts = ?2, last_error = ?3
            WHERE id = ?1`,
        )
          .bind(row.id, attempts, message)
          .run();
        out.failed++;
        // Never alert about a failing alert: that is the loop.
        if (row.template !== 'alert') {
          await alert(
            env,
            'email_outbox_failed',
            `outbox row ${row.id} to ${row.to_email} (${row.template}) failed after ${attempts} attempts.\n\n${message}`,
          );
        }
      } else {
        await env.DB.prepare(
          `UPDATE email_outbox
              SET attempts = ?2, last_error = ?3, next_attempt_at = ?4
            WHERE id = ?1`,
        )
          .bind(row.id, attempts, message, new Date(Date.now() + backoffMs(attempts)).toISOString())
          .run();
        out.retried++;
      }
    }
  }

  return out;
}
