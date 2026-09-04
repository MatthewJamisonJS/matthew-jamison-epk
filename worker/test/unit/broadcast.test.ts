import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleBroadcast } from '../../src/routes/broadcast';
import { render } from '../../src/lib/email';

const BEARER = 'k'.repeat(48);
const adminEnv = { ...env, ADMIN_BEARER_TOKEN: BEARER, ADMIN_EMAILS: 'matthew@example.com' };
const auth = { Authorization: `Bearer ${BEARER}` };

async function call(body: unknown, headers: Record<string, string> = {}) {
  const ctx = createExecutionContext();
  const req = new Request('https://api.example.com/admin/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await handleBroadcast(req, adminEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function seed(email: string, status: string) {
  await env.DB.prepare(
    `INSERT INTO subscribers
       (email, status, consent_source, consent_at, verify_token, verify_sent_at,
        verify_expires_at, confirmed_at, unsubscribed_at, unsubscribe_token,
        first_album_slug, consent_ip_country)
     VALUES (?1, ?2, 'site', '2026-01-01T00:00:00.000Z', NULL, NULL, NULL,
             NULL, NULL, ?3, NULL, NULL)`,
  )
    .bind(email, status, `unsub-${email}`)
    .run();
}

const outbox = async () =>
  (
    await env.DB.prepare(
      `SELECT to_email, template, payload_json FROM email_outbox ORDER BY to_email`,
    ).all<{ to_email: string; template: string; payload_json: string }>()
  ).results;

const NOTE = { subject: 'new record out friday', text: 'hey — new one lands friday.' };

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM subscribers`).run();
  await env.DB.prepare(`DELETE FROM email_outbox`).run();
  await env.DB.prepare(`DELETE FROM broadcasts`).run();
  await seed('one@example.com', 'confirmed');
  await seed('two@example.com', 'confirmed');
  await seed('three@example.com', 'confirmed');
  await seed('pending@example.com', 'pending');
  await seed('gone@example.com', 'unsubscribed');
  await seed('dead@example.com', 'bounced');
});

describe('auth', () => {
  it('401s with no credentials', async () => {
    expect((await call(NOTE)).status).toBe(401);
  });

  it('401s on a wrong bearer', async () => {
    expect((await call(NOTE, { Authorization: `Bearer ${'x'.repeat(48)}` })).status).toBe(401);
  });

  it('401s on a correct PREFIX of the bearer', async () => {
    expect((await call(NOTE, { Authorization: `Bearer ${BEARER.slice(0, 40)}` })).status).toBe(401);
  });

  it('writes nothing when unauthenticated', async () => {
    await call(NOTE);
    expect(await outbox()).toHaveLength(0);
  });
});

describe('validation', () => {
  it('400s on malformed JSON', async () => {
    expect((await call('{ nope', auth)).status).toBe(400);
  });

  it('400s without a subject', async () => {
    expect((await call({ text: 'hi' }, auth)).status).toBe(400);
  });

  it('400s without body text', async () => {
    expect((await call({ subject: 'hi', text: '   ' }, auth)).status).toBe(400);
  });
});

describe('dry run', () => {
  it('reports the confirmed count and writes nothing', async () => {
    const res = await call({ ...NOTE, dry_run: true }, auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dry_run: true, recipients: 3 });
    expect(await outbox()).toHaveLength(0);
    const bc = await env.DB.prepare(`SELECT COUNT(*) AS n FROM broadcasts`).first<{ n: number }>();
    expect(bc?.n).toBe(0);
  });

  it('is repeatable and does not block the real send', async () => {
    await call({ ...NOTE, dry_run: true }, auth);
    await call({ ...NOTE, dry_run: true }, auth);
    const res = await call(NOTE, auth);
    expect(res.status).toBe(200);
    expect(await outbox()).toHaveLength(3);
  });
});

describe('send', () => {
  it('queues one outbox row per confirmed subscriber and nobody else', async () => {
    const res = await call({ ...NOTE, url: 'https://matthewjamison.dev/#catalog' }, auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ recipients: 3, queued: 3 });

    const rows = await outbox();
    expect(rows.map((r) => r.to_email)).toEqual([
      'one@example.com',
      'three@example.com',
      'two@example.com',
    ]);
    expect(rows.every((r) => r.template === 'broadcast')).toBe(true);
  });

  it('gives each recipient their OWN unsubscribe token', async () => {
    await call(NOTE, auth);
    const tokens = (await outbox()).map(
      (r) => (JSON.parse(r.payload_json) as { unsubscribe_token: string }).unsubscribe_token,
    );
    expect(tokens).toEqual(['unsub-one@example.com', 'unsub-three@example.com', 'unsub-two@example.com']);
    expect(new Set(tokens).size).toBe(3);
  });

  it('renders an unsubscribe link and RFC 8058 headers on every mail', async () => {
    await call(NOTE, auth);
    for (const row of await outbox()) {
      const rendered = render(adminEnv, 'broadcast', JSON.parse(row.payload_json));
      const unsubUrl = `${env.WORKER_ORIGIN}/unsubscribe/unsub-${row.to_email}`;
      expect(rendered.subject).toBe(NOTE.subject);
      expect(rendered.text).toContain(unsubUrl);
      expect(rendered.html).toContain(unsubUrl);
      expect(rendered.headers?.['List-Unsubscribe']).toBe(`<${unsubUrl}>`);
      expect(rendered.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    }
  });

  it('sends nothing at all when there are no confirmed subscribers', async () => {
    await env.DB.prepare(`UPDATE subscribers SET status = 'pending'`).run();
    const res = await call(NOTE, auth);
    expect(await res.json()).toMatchObject({ recipients: 0, queued: 0 });
    expect(await outbox()).toHaveLength(0);
  });
});

describe('idempotency', () => {
  it('409s a same-day repeat of the same subject and reports the earlier count', async () => {
    const first = await call(NOTE, auth);
    const firstBody = (await first.json()) as { broadcast_id: string };

    const second = await call(NOTE, auth);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      error: 'already_sent',
      broadcast_id: firstBody.broadcast_id,
      recipients: 3,
    });

    // The whole point: no second copy landed in anyone's outbox.
    expect(await outbox()).toHaveLength(3);
  });

  it('allows a different subject on the same day', async () => {
    await call(NOTE, auth);
    const res = await call({ subject: 'one more thing', text: 'also this.' }, auth);
    expect(res.status).toBe(200);
    expect(await outbox()).toHaveLength(6);
  });

  it('allows the same subject on a different day', async () => {
    await call(NOTE, auth);
    await env.DB.prepare(`UPDATE broadcasts SET sent_on = '2001-01-01'`).run();
    const res = await call(NOTE, auth);
    expect(res.status).toBe(200);
    expect(await outbox()).toHaveLength(6);
  });
});
