import type { Ctx, Env } from '../types';
import { json } from '../lib/http';
import { enqueue } from '../lib/outbox';
import { isoNow, newId } from '../lib/tokens';
import { authenticate } from './admin';

const MAX_BODY_BYTES = 200_000;
const MAX_SUBJECT = 200;
const PAGE_SIZE = 500;

interface Recipient {
  email: string;
  unsubscribe_token: string;
}

/**
 * POST /admin/broadcast
 *   { subject, text, html?, url?, dry_run? }  ->  { queued, recipients, broadcast_id }
 *
 * Same guard as /admin/export: Cloudflare Access first, the long bearer as the
 * fallback, ADMIN_EMAILS checked either way.
 *
 * The invariant from lib/subscribers.ts holds here and is the reason the query
 * below is `status = 'confirmed'` with no options and no override parameter:
 * ONLY a confirmed subscriber may ever receive marketing. A `pending` row has
 * had exactly one verification email and gets nothing else, ever; `bounced`
 * and `unsubscribed` are out by the same clause. There is no flag to widen it.
 *
 * Nothing is sent inline. One outbox row per recipient, drained by the same
 * ten-minute cron as every other mail, so a list of any size cannot blow the
 * request's CPU budget and a provider outage retries with backoff instead of
 * losing the send.
 */
export async function handleBroadcast(req: Request, env: Env, ctx: Ctx): Promise<Response> {
  const auth = await authenticate(req, env, ctx);
  if ('error' in auth) return auth.error;

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, { status: 413 });

  let body: {
    subject?: unknown;
    text?: unknown;
    html?: unknown;
    url?: unknown;
    dry_run?: unknown;
  };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: 'bad_request' }, { status: 400 });
  }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const text = typeof body.text === 'string' ? body.text : '';
  if (!subject || subject.length > MAX_SUBJECT) {
    return json({ error: 'bad_subject' }, { status: 400 });
  }
  if (!text.trim()) {
    return json({ error: 'bad_text' }, { status: 400 });
  }
  const html = typeof body.html === 'string' ? body.html : undefined;
  const url = typeof body.url === 'string' ? body.url : undefined;
  const dryRun = body.dry_run === true;

  const recipients = await confirmedRecipients(env);

  if (dryRun) {
    // No broadcasts row, no outbox rows, no idempotency slot burned. A dry run
    // must be repeatable, and it must not block the real send that follows it.
    return json({ dry_run: true, recipients: recipients.length });
  }

  const sentOn = isoNow().slice(0, 10);
  const id = newId('bc');

  // Claim the (subject, sent_on) slot BEFORE any outbox row exists. If this
  // insert loses the UNIQUE race, the list has already been mailed today with
  // this subject and the correct answer is to send nothing.
  try {
    await env.DB.prepare(
      `INSERT INTO broadcasts (id, subject, sent_on, recipient_count, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(id, subject, sentOn, recipients.length, isoNow())
      .run();
  } catch {
    const prior = await env.DB.prepare(
      `SELECT id, recipient_count FROM broadcasts WHERE subject = ?1 AND sent_on = ?2`,
    )
      .bind(subject, sentOn)
      .first<{ id: string; recipient_count: number }>();
    if (prior) {
      return json(
        {
          error: 'already_sent',
          broadcast_id: prior.id,
          sent_on: sentOn,
          recipients: prior.recipient_count,
        },
        { status: 409 },
      );
    }
    return json({ error: 'broadcast_failed' }, { status: 500 });
  }

  let queued = 0;
  for (const r of recipients) {
    try {
      // The unsubscribe link is per recipient -- their own token, never a
      // shared one -- so the RFC 8058 one-click header actually unsubscribes
      // the person who pressed it.
      await enqueue(env, r.email, 'broadcast', {
        subject,
        text,
        ...(html ? { html } : {}),
        ...(url ? { url } : {}),
        unsubscribe_token: r.unsubscribe_token,
        broadcast_id: id,
      });
      queued++;
    } catch (err) {
      console.error(
        JSON.stringify({ level: 'error', at: 'broadcast', broadcast_id: id, err: String(err) }),
      );
    }
  }

  console.log(
    JSON.stringify({ level: 'info', at: 'broadcast', broadcast_id: id, queued, actor: auth.actor.via }),
  );

  return json({ broadcast_id: id, sent_on: sentOn, recipients: recipients.length, queued });
}

/** Keyset-paged so the recipient list is never one unbounded D1 query. */
async function confirmedRecipients(env: Env): Promise<Recipient[]> {
  const out: Recipient[] = [];
  let after = '';
  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT email, unsubscribe_token FROM subscribers
        WHERE status = 'confirmed' AND email > ?1
        ORDER BY email ASC LIMIT ?2`,
    )
      .bind(after, PAGE_SIZE)
      .all<Recipient>();
    out.push(...results);
    if (results.length < PAGE_SIZE) return out;
    after = results[results.length - 1]!.email;
  }
}
