import type { AlbumRow, Env, Format, TokenRow } from '../types';
import { isoIn, isoNow, newToken } from './tokens';

/**
 * Every query in this file uses bound parameters. There is no string
 * interpolation of user input anywhere in the codebase; the one place that
 * builds SQL dynamically (routes/admin.ts) interpolates only whitelisted
 * column names and still binds every value.
 */

export async function getActiveAlbum(env: Env, slug: string): Promise<AlbumRow | null> {
  return env.DB.prepare(
    `SELECT slug, title, kind, price_cents, stripe_price_id,
            r2_key_wav, r2_key_mp3, active
       FROM albums WHERE slug = ?1 AND active = 1`,
  )
    .bind(slug)
    .first<AlbumRow>();
}

export async function getAlbum(env: Env, slug: string): Promise<AlbumRow | null> {
  return env.DB.prepare(
    `SELECT slug, title, kind, price_cents, stripe_price_id,
            r2_key_wav, r2_key_mp3, active
       FROM albums WHERE slug = ?1`,
  )
    .bind(slug)
    .first<AlbumRow>();
}

export function r2KeyFor(album: AlbumRow, format: Format): string {
  return format === 'wav' ? album.r2_key_wav : album.r2_key_mp3;
}

export function formatLabel(format: Format): string {
  return format === 'wav' ? 'WAV' : 'MP3 320';
}

/**
 * The slug embedded in an R2 key, which is always `albums/{slug}/{file}` --
 * enforced on write by the /admin/mpu key regex. A bundle row's two key slots
 * point at other albums' zips, so this is how a bundle finds its parts without
 * a join table or hardcoded product names. Null for any key that is not that
 * shape, and callers must handle null rather than guess.
 */
export function slugFromR2Key(key: string): string | null {
  const m = /^albums\/([a-z0-9-]+)\//.exec(key);
  return m ? m[1]! : null;
}

export async function getToken(env: Env, token: string): Promise<TokenRow | null> {
  return env.DB.prepare(
    `SELECT token, purchase_id, album_slug, expires_at, max_downloads,
            download_count, revoked_at, created_at
       FROM download_tokens WHERE token = ?1`,
  )
    .bind(token)
    .first<TokenRow>();
}

export async function createDownloadToken(
  env: Env,
  purchaseId: string,
  albumSlug: string,
): Promise<string> {
  const token = newToken();
  const ttlHours = intVar(env.DOWNLOAD_TTL_HOURS, 72);
  const maxDownloads = intVar(env.MAX_DOWNLOADS, 5);
  await env.DB.prepare(
    `INSERT INTO download_tokens
       (token, purchase_id, album_slug, expires_at, max_downloads,
        download_count, revoked_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, NULL, ?6)`,
  )
    .bind(token, purchaseId, albumSlug, isoIn(ttlHours * 3600_000), maxDownloads, isoNow())
    .run();
  return token;
}

/**
 * The atomic consume. Read-then-write loses the race between two clicks; this
 * pushes every precondition into the WHERE clause so SQLite decides, once.
 * Caller checks meta.changes: 0 means invalid/expired/exhausted/revoked and
 * NOTHING was spent.
 */
export async function consumeDownload(env: Env, token: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE download_tokens
        SET download_count = download_count + 1
      WHERE token = ?1
        AND revoked_at IS NULL
        AND datetime(expires_at) > datetime('now')
        AND download_count < max_downloads`,
  )
    .bind(token)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * Give the download back. Only ever called when the counter was spent and the
 * R2 object then turned out to be missing -- our failure, not the customer's.
 */
export async function refundDownload(env: Env, token: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE download_tokens
        SET download_count = download_count - 1
      WHERE token = ?1 AND download_count > 0`,
  )
    .bind(token)
    .run();
}

export async function revokeTokensForPurchase(env: Env, purchaseId: string): Promise<number> {
  const res = await env.DB.prepare(
    `UPDATE download_tokens SET revoked_at = ?2
      WHERE purchase_id = ?1 AND revoked_at IS NULL`,
  )
    .bind(purchaseId, isoNow())
    .run();
  return res.meta.changes ?? 0;
}

export async function logDownloadEvent(
  env: Env,
  token: string,
  outcome: string,
  format: Format | null,
  ipCountry: string | null,
  userAgent: string | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO download_events (token, occurred_at, format, outcome, ip_country, user_agent)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(
      token.slice(0, 128),
      isoNow(),
      format,
      outcome,
      ipCountry,
      (userAgent ?? '').slice(0, 300) || null,
    )
    .run();
}

export function intVar(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
