import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleSubscribe, handleSubscribePreflight } from '../../src/routes/subscribe';

const ORIGIN = env.SITE_ORIGIN;

async function post(
  body: unknown,
  { origin = ORIGIN, ip = '203.0.113.9' }: { origin?: string | null; ip?: string } = {},
) {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'CF-Connecting-IP': ip,
  };
  if (origin) headers.Origin = origin;
  const req = new Request('https://api.example.com/subscribe', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await handleSubscribe(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const countSubscribers = async () =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM subscribers`).first<{ n: number }>())?.n ?? 0;

const countVerifyMail = async (email: string) =>
  (
    await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM email_outbox WHERE to_email = ?1 AND template = 'verify_subscription'`,
    )
      .bind(email)
      .first<{ n: number }>()
  )?.n ?? 0;

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM subscribers`).run();
  await env.DB.prepare(`DELETE FROM email_outbox`).run();
  await env.DB.prepare(`DELETE FROM ip_rate`).run();
});

describe('origin and preflight', () => {
  it('403s a request from another origin', async () => {
    const res = await post({ email: 'a@example.com' }, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await countSubscribers()).toBe(0);
  });

  it('403s the preflight from another origin', async () => {
    const req = new Request('https://api.example.com/subscribe', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    expect((await handleSubscribePreflight(req, env)).status).toBe(403);
  });

  it('204s the preflight from the site origin with CORS headers', async () => {
    const req = new Request('https://api.example.com/subscribe', {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN },
    });
    const res = await handleSubscribePreflight(req, env);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });
});

describe('honeypot', () => {
  it('202s a filled honeypot and writes nothing', async () => {
    const res = await post({ email: 'bot@example.com', website: 'http://spam.example' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(await countSubscribers()).toBe(0);
    expect(await countVerifyMail('bot@example.com')).toBe(0);
  });

  it('accepts an empty honeypot as a real submit', async () => {
    const res = await post({ email: 'real@example.com', website: '' });
    expect(res.status).toBe(202);
    expect(await countSubscribers()).toBe(1);
  });
});

describe('valid signup', () => {
  it('202s, creates one pending row, queues one verify email', async () => {
    const res = await post({ email: 'Fan@Example.COM ' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });

    const row = await env.DB.prepare(`SELECT * FROM subscribers`).first<Record<string, unknown>>();
    // normalized by the same helper the webhook uses: trimmed, lowercased
    expect(row?.email).toBe('fan@example.com');
    expect(row?.status).toBe('pending');
    expect(row?.consent_source).toBe('site');
    expect(row?.first_album_slug).toBeNull();

    expect(await countVerifyMail('fan@example.com')).toBe(1);
  });

  it('is idempotent: the same address twice is still one row and one email', async () => {
    await post({ email: 'twice@example.com' });
    const res = await post({ email: 'twice@example.com' });
    expect(res.status).toBe(202);
    expect(await countSubscribers()).toBe(1);
    // A second verification email is exactly what double opt-in exists to avoid.
    expect(await countVerifyMail('twice@example.com')).toBe(1);
  });

  it('never mails a confirmed subscriber again when they re-submit', async () => {
    await post({ email: 'conf@example.com' });
    await env.DB.prepare(`UPDATE subscribers SET status = 'confirmed' WHERE email = ?1`)
      .bind('conf@example.com')
      .run();
    await post({ email: 'conf@example.com' });
    expect(await countVerifyMail('conf@example.com')).toBe(1);
  });
});

describe('bad input', () => {
  it.each(['nope', 'no@domain', '@example.com', 'a b@example.com', '', 'x@y.c om'])(
    '202s without a row for %j',
    async (email) => {
      const res = await post({ email });
      expect(res.status).toBe(202);
      expect(await countSubscribers()).toBe(0);
    },
  );

  it('202s without a row when email is missing or not a string', async () => {
    expect((await post({})).status).toBe(202);
    expect((await post({ email: 12 })).status).toBe(202);
    expect(await countSubscribers()).toBe(0);
  });

  it('400s only on malformed JSON', async () => {
    const res = await post('{ not json');
    expect(res.status).toBe(400);
  });
});

describe('per-IP rate limit', () => {
  it('lets 5 through in an hour and no-ops the 6th', async () => {
    for (let i = 1; i <= 5; i++) {
      const res = await post({ email: `n${i}@example.com` }, { ip: '198.51.100.7' });
      expect(res.status).toBe(202);
    }
    expect(await countSubscribers()).toBe(5);

    const sixth = await post({ email: 'n6@example.com' }, { ip: '198.51.100.7' });
    // Indistinguishable from success on the wire, but nothing was written.
    expect(sixth.status).toBe(202);
    expect(await sixth.json()).toEqual({ ok: true });
    expect(await countSubscribers()).toBe(5);
    expect(await countVerifyMail('n6@example.com')).toBe(0);
  });

  it('counts per IP, not globally', async () => {
    for (let i = 1; i <= 5; i++) await post({ email: `a${i}@example.com` }, { ip: '198.51.100.1' });
    const other = await post({ email: 'other@example.com' }, { ip: '198.51.100.2' });
    expect(other.status).toBe(202);
    expect(await countSubscribers()).toBe(6);
  });

  it('resets once the window has rolled over', async () => {
    for (let i = 1; i <= 5; i++) await post({ email: `w${i}@example.com` }, { ip: '198.51.100.3' });
    await env.DB.prepare(`UPDATE ip_rate SET window_start = ?1 WHERE key = ?2`)
      .bind(new Date(Date.now() - 7_200_000).toISOString(), 'subscribe:198.51.100.3')
      .run();
    await post({ email: 'w6@example.com' }, { ip: '198.51.100.3' });
    expect(await countSubscribers()).toBe(6);
  });
});
