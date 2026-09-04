import type { Ctx, Env } from '../types';
import { clientIp, corsHeaders, ipCountry, json } from '../lib/http';
import { recordConsent } from '../lib/subscribers';
import { isoNow, normalizeEmail } from '../lib/tokens';

const MAX_BODY_BYTES = 2048;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 3_600_000;

/**
 * Deliberately loose. This regex is a typo catcher, not an authority on what
 * an address may contain -- the authority is the verification email, which
 * only a real mailbox can click. Anything that gets past here and is not real
 * simply never confirms and never receives marketing.
 */
const EMAIL_RE = /^[^\s@,;<>"]{1,64}@[^\s@,;<>"]{1,190}\.[A-Za-z]{2,24}$/;

export async function handleSubscribePreflight(req: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(env, req);
  if (Object.keys(cors).length === 0) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: cors });
}

/**
 * POST /subscribe  { "email": "...", "website": "" }  ->  202 { ok: true }
 *
 * Every outcome that is not malformed JSON answers 202 with the same body.
 * That is the whole anti-enumeration design: a rejected honeypot, a rate-
 * limited IP, a typo'd address and a brand new signup are indistinguishable
 * from the outside. What actually happened is in the logs, not the response.
 *
 * The double opt-in state machine lives in lib/subscribers.ts and is NOT
 * duplicated here -- pending/confirmed/unsubscribed re-consent, the single
 * verification email, and the "an unsubscribe takes fresh consent to undo"
 * rule are all its job. This route's only additions are the honeypot and the
 * per-IP window.
 */
export async function handleSubscribe(req: Request, env: Env, _ctx: Ctx): Promise<Response> {
  const cors = corsHeaders(env, req);

  // Same exact-match origin rule as /checkout. No prefix match, no reflection.
  if (req.headers.get('Origin') !== env.SITE_ORIGIN) {
    return json({ error: 'forbidden' }, { status: 403 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: 'bad_request' }, { status: 413, headers: cors });
  }

  let body: { email?: unknown; website?: unknown };
  try {
    body = JSON.parse(raw) as { email?: unknown; website?: unknown };
  } catch {
    return json({ error: 'bad_request' }, { status: 400, headers: cors });
  }

  const ok = () => json({ ok: true }, { status: 202, headers: cors });

  // Honeypot. The field is present in the form, hidden from people, and empty
  // for every real submit. A bot that fills every input fills this one too.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    console.warn(JSON.stringify({ level: 'warn', at: 'subscribe', outcome: 'honeypot' }));
    return ok();
  }

  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '');
  if (!EMAIL_RE.test(email)) {
    // Logged without the address: a bad address is still someone's typo.
    console.warn(JSON.stringify({ level: 'warn', at: 'subscribe', outcome: 'invalid_email' }));
    return ok();
  }

  if (!(await underRateLimit(env, `subscribe:${clientIp(req)}`))) {
    console.warn(JSON.stringify({ level: 'warn', at: 'subscribe', outcome: 'rate_limited' }));
    return ok();
  }

  try {
    const outcome = await recordConsent(env, email, null, ipCountry(req), 'site');
    console.log(JSON.stringify({ level: 'info', at: 'subscribe', outcome }));
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', at: 'subscribe', err: String(err) }));
  }

  return ok();
}

/**
 * Fixed one-hour window, 5 submits per IP, counted in D1.
 *
 * Not the RATELIMIT binding: that one is per-location and locally cached,
 * which is fine in front of Stripe but too soft for the thing that mints rows
 * in `subscribers`. Not KV either -- this Worker has no KV namespace, and an
 * eventually-consistent counter is exactly the wrong shape for a limit.
 *
 * One statement, so the read-modify-write cannot interleave: the CASE resets
 * the window in the same UPDATE that increments it, and RETURNING hands back
 * the post-increment count.
 */
async function underRateLimit(env: Env, key: string): Promise<boolean> {
  const now = isoNow();
  const cutoff = new Date(Date.now() - RATE_WINDOW_MS).toISOString();

  const row = await env.DB.prepare(
    `INSERT INTO ip_rate (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN datetime(ip_rate.window_start) <= datetime(?3)
                    THEN 1 ELSE ip_rate.count + 1 END,
       window_start = CASE WHEN datetime(ip_rate.window_start) <= datetime(?3)
                           THEN ?2 ELSE ip_rate.window_start END
     RETURNING count`,
  )
    .bind(key, now, cutoff)
    .first<{ count: number }>();

  return (row?.count ?? 1) <= RATE_LIMIT;
}
