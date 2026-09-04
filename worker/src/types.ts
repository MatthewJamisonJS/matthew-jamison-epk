/** Rate limit binding (GA Sept 2025). Not yet in @cloudflare/workers-types. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Cloudflare Access for Workers attaches identity to the execution context as
 * `ctx.access`, typed by @cloudflare/workers-types. It is `undefined` when
 * Access is not enabled on the Worker, which is what the bearer fallback in
 * routes/admin.ts is for.
 *
 * Access AUTHENTICATES; it does not authorize -- the email is still checked
 * against ADMIN_EMAILS.
 */
export type Ctx = ExecutionContext;

export interface Env {
  // bindings
  DB: D1Database;
  ALBUMS: R2Bucket;
  DOWNLOAD_LIMITER: RateLimiter;
  CHECKOUT_LIMITER: RateLimiter;
  ADMIN_LIMITER: RateLimiter;

  // vars
  SITE_ORIGIN: string;
  WORKER_ORIGIN: string;
  EMAIL_FROM: string;
  EMAIL_REPLY_TO: string;
  ALERT_EMAIL: string;
  ADMIN_EMAILS: string;
  STRIPE_LIVEMODE: string;
  DOWNLOAD_TTL_HOURS: string;
  MAX_DOWNLOADS: string;
  VERIFY_TTL_DAYS: string;

  // secrets (wrangler secret put)
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  EMAIL_API_KEY: string;
  /** Fallback admin auth when Zero Trust Access is not enabled. Weaker. */
  ADMIN_BEARER_TOKEN?: string;
}

/**
 * The two R2 key slots on a row. For music these really are formats. For a
 * 'pack' both slots hold the same zip, and for a 'bundle' they hold the two
 * pack zips -- so treat this as "which slot", not "which encoding", and read
 * the customer-facing wording off the album kind instead.
 */
export type Format = 'wav' | 'mp3';

/**
 * 'pack'   -- sample pack: one zip, both key slots identical.
 * 'bundle' -- two packs sold together: the key slots are the two pack zips.
 */
export type AlbumKind = 'single' | 'ep' | 'album' | 'pack' | 'bundle';

export interface AlbumRow {
  slug: string;
  title: string;
  kind: AlbumKind;
  price_cents: number;
  stripe_price_id: string;
  r2_key_wav: string;
  r2_key_mp3: string;
  active: number;
}

export interface TokenRow {
  token: string;
  purchase_id: string;
  album_slug: string;
  expires_at: string;
  max_downloads: number;
  download_count: number;
  revoked_at: string | null;
  created_at: string;
}

/**
 * Which door the consent came through. 'checkout' = the Stripe promotional
 * checkbox; 'site' = the subscribe form in #contact (POST /subscribe).
 * Labelling only -- the double opt-in state machine is identical for both.
 */
export type ConsentSource = 'checkout' | 'site';

export interface SubscriberRow {
  email: string;
  status: 'pending' | 'confirmed' | 'unsubscribed' | 'bounced';
  consent_source: ConsentSource;
  consent_at: string;
  verify_token: string | null;
  verify_sent_at: string | null;
  verify_expires_at: string | null;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  unsubscribe_token: string;
  first_album_slug: string | null;
  consent_ip_country: string | null;
}

/** Per-IP submit counter for POST /subscribe. One row per key per window. */
export interface IpRateRow {
  key: string;
  count: number;
  window_start: string;
}

/** One row per sent broadcast. UNIQUE(subject, sent_on) is the idempotency key. */
export interface BroadcastRow {
  id: string;
  subject: string;
  sent_on: string;
  recipient_count: number;
  created_at: string;
}
