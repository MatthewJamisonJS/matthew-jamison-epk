import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumeDownload,
  createDownloadToken,
  getToken,
  refundDownload,
  revokeTokensForPurchase,
} from '../../src/lib/db';
import { isoIn, isoNow } from '../../src/lib/tokens';

/**
 * These run against Miniflare's real SQLite. That is the point: the whole
 * guard is a WHERE clause, so it has to be a real engine evaluating it.
 */

async function seedPurchase(id: string, slug = 'example-album') {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO albums
       (slug, title, kind, price_cents, stripe_price_id, r2_key_wav, r2_key_mp3, active)
     VALUES (?1, 'Example Album', 'album', 999, ?2, 'k/wav.zip', 'k/mp3.zip', 1)`,
  )
    .bind(slug, `price_${slug}`)
    .run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO purchases
       (id, payment_intent_id, email, album_slug, amount_total_cents, tax_cents,
        currency, country, status, created_at)
     VALUES (?1, 'pi_test', 'fan@example.com', ?2, 999, 0, 'usd', 'US', 'paid', ?3)`,
  )
    .bind(id, slug, isoNow())
    .run();
}

async function insertToken(
  token: string,
  purchaseId: string,
  overrides: { expires_at?: string; max_downloads?: number; download_count?: number; revoked_at?: string | null } = {},
) {
  await env.DB.prepare(
    `INSERT INTO download_tokens
       (token, purchase_id, album_slug, expires_at, max_downloads, download_count, revoked_at, created_at)
     VALUES (?1, ?2, 'example-album', ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      token,
      purchaseId,
      overrides.expires_at ?? isoIn(72 * 3600_000),
      overrides.max_downloads ?? 5,
      overrides.download_count ?? 0,
      overrides.revoked_at ?? null,
      isoNow(),
    )
    .run();
}

describe('atomic download consume', () => {
  beforeEach(async () => {
    await seedPurchase('cs_atomic');
  });

  it('succeeds and increments exactly once', async () => {
    await insertToken('tok_ok', 'cs_atomic');
    expect(await consumeDownload(env, 'tok_ok')).toBe(true);
    expect((await getToken(env, 'tok_ok'))!.download_count).toBe(1);
  });

  it('allows exactly max_downloads and then refuses', async () => {
    await insertToken('tok_five', 'cs_atomic', { max_downloads: 5 });
    for (let i = 1; i <= 5; i++) {
      expect(await consumeDownload(env, 'tok_five')).toBe(true);
    }
    expect(await consumeDownload(env, 'tok_five')).toBe(false);
    // The refusal must not have incremented past the ceiling.
    expect((await getToken(env, 'tok_five'))!.download_count).toBe(5);
  });

  it('refuses an expired token and spends nothing', async () => {
    await insertToken('tok_exp', 'cs_atomic', { expires_at: isoIn(-3600_000) });
    expect(await consumeDownload(env, 'tok_exp')).toBe(false);
    expect((await getToken(env, 'tok_exp'))!.download_count).toBe(0);
  });

  it('refuses a revoked token and spends nothing', async () => {
    await insertToken('tok_rev', 'cs_atomic', { revoked_at: isoNow() });
    expect(await consumeDownload(env, 'tok_rev')).toBe(false);
    expect((await getToken(env, 'tok_rev'))!.download_count).toBe(0);
  });

  it('refuses an unknown token without creating anything', async () => {
    expect(await consumeDownload(env, 'tok_nope')).toBe(false);
    expect(await getToken(env, 'tok_nope')).toBeNull();
  });

  it('lets exactly one of two racing requests through at count = 4', async () => {
    // The read-then-write version of this code lets both through.
    await insertToken('tok_race', 'cs_atomic', { max_downloads: 5, download_count: 4 });
    const [a, b] = await Promise.all([
      consumeDownload(env, 'tok_race'),
      consumeDownload(env, 'tok_race'),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await getToken(env, 'tok_race'))!.download_count).toBe(5);
  });

  it('never exceeds the ceiling under heavy concurrency', async () => {
    await insertToken('tok_storm', 'cs_atomic', { max_downloads: 5, download_count: 0 });
    const results = await Promise.all(
      Array.from({ length: 25 }, () => consumeDownload(env, 'tok_storm')),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    expect((await getToken(env, 'tok_storm'))!.download_count).toBe(5);
  });
});

describe('refund after a missing R2 object', () => {
  beforeEach(async () => {
    await seedPurchase('cs_refund');
  });

  it('gives the download back', async () => {
    await insertToken('tok_refund', 'cs_refund');
    await consumeDownload(env, 'tok_refund');
    await refundDownload(env, 'tok_refund');
    expect((await getToken(env, 'tok_refund'))!.download_count).toBe(0);
  });

  it('cannot drive the counter negative', async () => {
    await insertToken('tok_neg', 'cs_refund');
    await refundDownload(env, 'tok_neg');
    await refundDownload(env, 'tok_neg');
    expect((await getToken(env, 'tok_neg'))!.download_count).toBe(0);
  });
});

describe('revocation on refund or dispute', () => {
  it('revokes every live token for the purchase and is idempotent', async () => {
    await seedPurchase('cs_revoke');
    await insertToken('tok_r1', 'cs_revoke');
    await insertToken('tok_r2', 'cs_revoke');

    expect(await revokeTokensForPurchase(env, 'cs_revoke')).toBe(2);
    expect(await revokeTokensForPurchase(env, 'cs_revoke')).toBe(0);

    expect(await consumeDownload(env, 'tok_r1')).toBe(false);
    expect(await consumeDownload(env, 'tok_r2')).toBe(false);
  });
});

describe('createDownloadToken', () => {
  it('honours DOWNLOAD_TTL_HOURS and MAX_DOWNLOADS', async () => {
    await seedPurchase('cs_mint');
    const token = await createDownloadToken(env, 'cs_mint', 'example-album');
    const row = (await getToken(env, token))!;
    expect(row.max_downloads).toBe(Number(env.MAX_DOWNLOADS));
    const hours = (Date.parse(row.expires_at) - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(Number(env.DOWNLOAD_TTL_HOURS) - 1);
    expect(hours).toBeLessThanOrEqual(Number(env.DOWNLOAD_TTL_HOURS));
  });
});
