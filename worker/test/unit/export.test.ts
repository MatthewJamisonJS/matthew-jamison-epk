import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleExport } from '../../src/routes/admin';

const BEARER = 'k'.repeat(48);
const adminEnv = { ...env, ADMIN_BEARER_TOKEN: BEARER, ADMIN_EMAILS: 'matthew@example.com' };

async function call(query: string, headers: Record<string, string> = {}) {
  const ctx = createExecutionContext();
  const req = new Request(`https://api.example.com/admin/export?${query}`, { headers });
  const res = await handleExport(req, adminEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const auth = { Authorization: `Bearer ${BEARER}` };

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM subscribers`).run();
  await env.DB.prepare(`DELETE FROM export_log`).run();
  const rows: Array<[string, string, string, string | null]> = [
    ['yes@example.com', 'confirmed', '2026-03-01T00:00:00.000Z', '2026-03-02T00:00:00.000Z'],
    ['wait@example.com', 'pending', '2026-04-01T00:00:00.000Z', null],
    ['gone@example.com', 'unsubscribed', '2026-05-01T00:00:00.000Z', null],
    ['dead@example.com', 'bounced', '2026-06-01T00:00:00.000Z', null],
    ['comma@example.com', 'confirmed', '2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z'],
  ];
  for (const [email, status, consentAt, confirmedAt] of rows) {
    await env.DB.prepare(
      `INSERT INTO subscribers
         (email, status, consent_source, consent_at, verify_token, verify_sent_at,
          verify_expires_at, confirmed_at, unsubscribed_at, unsubscribe_token,
          first_album_slug, consent_ip_country)
       VALUES (?1, ?2, 'checkout', ?3, NULL, NULL, NULL, ?4, NULL, ?5, ?6, 'US')`,
    )
      .bind(email, status, consentAt, confirmedAt, `unsub_${email}`, 'ryoko, part two')
      .run();
  }
});

describe('export auth', () => {
  it('401s with no credentials at all', async () => {
    const res = await call('dataset=subscribers');
    expect(res.status).toBe(401);
  });

  it('401s on a wrong bearer token', async () => {
    const res = await call('dataset=subscribers', { Authorization: `Bearer ${'x'.repeat(48)}` });
    expect(res.status).toBe(401);
  });

  it('401s on a correct PREFIX of the bearer token', async () => {
    const res = await call('dataset=subscribers', { Authorization: `Bearer ${BEARER.slice(0, 40)}` });
    expect(res.status).toBe(401);
  });

  it('accepts the exact bearer token', async () => {
    const res = await call('dataset=subscribers', auth);
    expect(res.status).toBe(200);
  });
});

describe('dataset and format whitelist', () => {
  it.each(['../../etc/passwd', 'sqlite_schema', 'albums', 'purchases; DROP TABLE purchases', ''])(
    'rejects dataset=%j',
    async (dataset) => {
      const res = await call(`dataset=${encodeURIComponent(dataset)}`, auth);
      expect(res.status).toBe(400);
    },
  );

  it('rejects an unknown format', async () => {
    const res = await call('dataset=subscribers&format=xlsx', auth);
    expect(res.status).toBe(400);
  });

  it('rejects a status value outside the dataset whitelist', async () => {
    const res = await call('dataset=subscribers&status=admin', auth);
    expect(res.status).toBe(400);
  });

  it('rejects a malformed date', async () => {
    expect((await call('dataset=subscribers&from=yesterday', auth)).status).toBe(400);
  });

  it('rejects a malformed cursor', async () => {
    expect((await call('dataset=subscribers&cursor=%20%20', auth)).status).toBe(400);
  });
});

describe('the marketing-list export', () => {
  it('returns ONLY confirmed rows, with confirmed_at as proof of opt-in', async () => {
    const res = await call('dataset=subscribers&consent=confirmed&format=csv', auth);
    const body = await res.text();

    expect(body).toContain('yes@example.com');
    expect(body).toContain('comma@example.com');
    expect(body).not.toContain('wait@example.com');
    expect(body).not.toContain('gone@example.com');
    expect(body).not.toContain('dead@example.com');
    expect(body).toContain('confirmed_at');
    expect(body).toContain('2026-03-02T00:00:00.000Z');
  });

  it('puts a UTF-8 BOM on the wire so Excel reads it as UTF-8', async () => {
    // Response.text() strips the BOM per the encoding spec, so this has to be
    // asserted on the raw bytes -- the thing Excel actually sees.
    const buf = await call('dataset=subscribers&format=csv', auth).then((r) => r.arrayBuffer());
    expect([...new Uint8Array(buf).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('starts with a header row naming every column', async () => {
    const body = await call('dataset=subscribers&format=csv', auth).then((r) => r.text());
    expect(body.split('\r\n')[0]).toBe(
      'email,status,consent_source,consent_at,confirmed_at,unsubscribed_at,first_album_slug,consent_ip_country',
    );
  });

  it('quotes a value containing a comma instead of splitting the row', async () => {
    const body = await call('dataset=subscribers&format=csv', auth).then((r) => r.text());
    expect(body).toContain('"ryoko, part two"');
    const dataLines = body.trim().split('\r\n').slice(1);
    for (const line of dataLines) {
      expect(line.split('"')).toHaveLength(3); // exactly one quoted field
    }
  });

  it('excludes bounced addresses by default', async () => {
    const body = await call('dataset=subscribers&format=csv', auth).then((r) => r.text());
    expect(body).not.toContain('dead@example.com');
  });

  it('still returns bounced when asked for by name', async () => {
    const body = await call('dataset=subscribers&status=bounced&format=csv', auth).then((r) =>
      r.text(),
    );
    expect(body).toContain('dead@example.com');
  });

  it('offers the file as a download', async () => {
    const res = await call('dataset=subscribers&format=csv', auth);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
  });
});

describe('date window', () => {
  it('applies from inclusive and to exclusive', async () => {
    const body = await call(
      'dataset=subscribers&from=2026-04-01&to=2026-06-01&format=ndjson',
      auth,
    ).then((r) => r.text());
    const emails = body.trim().split('\n').map((l) => JSON.parse(l).email);
    expect(emails).toContain('wait@example.com'); // exactly at `from`
    expect(emails).toContain('gone@example.com');
    expect(emails).not.toContain('dead@example.com'); // exactly at `to`
    expect(emails).not.toContain('yes@example.com');
  });
});

describe('json shape', () => {
  it('emits a valid array', async () => {
    const body = await call('dataset=subscribers&format=json', auth).then((r) => r.text());
    const parsed = JSON.parse(body);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(4); // bounced excluded
  });

  it('emits a valid empty array when nothing matches', async () => {
    const body = await call('dataset=subscribers&from=2030-01-01&format=json', auth).then((r) =>
      r.text(),
    );
    expect(JSON.parse(body)).toEqual([]);
  });
});

describe('export_log', () => {
  it('writes one row per request with a row count that matches', async () => {
    const body = await call('dataset=subscribers&consent=confirmed&format=csv', auth).then((r) =>
      r.text(),
    );
    const dataRows = body.trim().split('\r\n').length - 1;

    const log = await env.DB.prepare(
      `SELECT actor_email, dataset, row_count, filters_json FROM export_log ORDER BY id DESC LIMIT 1`,
    ).first<{ actor_email: string; dataset: string; row_count: number; filters_json: string }>();

    expect(log).not.toBeNull();
    expect(log!.dataset).toBe('subscribers');
    expect(log!.row_count).toBe(dataRows);
    expect(log!.row_count).toBe(2);
    expect(JSON.parse(log!.filters_json).status).toBe('confirmed');
  });

  it('logs even a zero-row export', async () => {
    await call('dataset=subscribers&from=2030-01-01&format=csv', auth).then((r) => r.text());
    const log = await env.DB.prepare(
      `SELECT row_count FROM export_log ORDER BY id DESC LIMIT 1`,
    ).first<{ row_count: number }>();
    expect(log!.row_count).toBe(0);
  });

  it('does not log a rejected request', async () => {
    await call('dataset=../../etc', auth);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM export_log`).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});

describe('limit', () => {
  it('caps the row count', async () => {
    const body = await call('dataset=subscribers&format=ndjson&limit=2', auth).then((r) => r.text());
    expect(body.trim().split('\n')).toHaveLength(2);
  });
});
