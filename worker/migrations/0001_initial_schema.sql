-- mj-music initial schema.
--
-- Additive-only rule: D1 migrations do not roll back. Never drop a column in
-- the same deploy that stops using it. New tables and nullable columns only.

-- Catalog. Lets albums be added without redeploying the Worker.
-- price_cents is DISPLAY/AUDIT truth only. The amount actually charged is
-- always whatever Stripe has on stripe_price_id -- the client never sends one.
CREATE TABLE albums (
  slug            TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('single', 'ep', 'album')),
  price_cents     INTEGER NOT NULL,
  stripe_price_id TEXT NOT NULL UNIQUE,
  r2_key_wav      TEXT NOT NULL,
  r2_key_mp3      TEXT NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1
);

-- Webhook dedupe. A row is written BEFORE any side effect runs.
CREATE TABLE stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE purchases (
  id                 TEXT PRIMARY KEY,          -- stripe checkout session id
  payment_intent_id  TEXT,
  email              TEXT NOT NULL,             -- normalized: trimmed, lowercased
  album_slug         TEXT NOT NULL,
  amount_total_cents INTEGER NOT NULL,
  tax_cents          INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'usd',
  country            TEXT,
  status             TEXT NOT NULL DEFAULT 'paid'
                     CHECK (status IN ('paid', 'unpaid', 'failed', 'refunded', 'disputed')),
  created_at         TEXT NOT NULL
);
CREATE INDEX idx_purchases_email   ON purchases(email);
CREATE INDEX idx_purchases_created ON purchases(created_at);
CREATE INDEX idx_purchases_album   ON purchases(album_slug);
CREATE INDEX idx_purchases_pi      ON purchases(payment_intent_id);

-- One token per purchase, good for BOTH formats. Format is chosen at fetch
-- time (/d/:token/file?format=wav|mp3) and the 5 downloads are a SHARED
-- counter across formats -- hence no `format` column here.
CREATE TABLE download_tokens (
  token          TEXT PRIMARY KEY,
  purchase_id    TEXT NOT NULL REFERENCES purchases(id),
  album_slug     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  max_downloads  INTEGER NOT NULL DEFAULT 5,
  download_count INTEGER NOT NULL DEFAULT 0,
  revoked_at     TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_tokens_purchase ON download_tokens(purchase_id);
CREATE INDEX idx_tokens_expires  ON download_tokens(expires_at);

-- Audit trail per download attempt: the "did they actually get it" record.
CREATE TABLE download_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  format      TEXT,
  outcome     TEXT NOT NULL,  -- served | landing | expired | exhausted | revoked | notfound | r2_missing | reissued
  ip_country  TEXT,
  user_agent  TEXT
);
CREATE INDEX idx_download_events_token    ON download_events(token);
CREATE INDEX idx_download_events_occurred ON download_events(occurred_at);

-- The list. Double opt-in state lives here.
CREATE TABLE subscribers (
  email              TEXT PRIMARY KEY,          -- normalized: trimmed, lowercased
  status             TEXT NOT NULL
                     CHECK (status IN ('pending', 'confirmed', 'unsubscribed', 'bounced')),
  consent_source     TEXT NOT NULL,             -- 'checkout'
  consent_at         TEXT NOT NULL,
  verify_token       TEXT UNIQUE,
  verify_sent_at     TEXT,
  verify_expires_at  TEXT,
  confirmed_at       TEXT,
  unsubscribed_at    TEXT,
  unsubscribe_token  TEXT NOT NULL UNIQUE,
  first_album_slug   TEXT,
  consent_ip_country TEXT
);
CREATE INDEX idx_subscribers_status ON subscribers(status);

-- Durable email queue. Survives Worker crashes without needing Queues.
CREATE TABLE email_outbox (
  id              TEXT PRIMARY KEY,
  to_email        TEXT NOT NULL,
  template        TEXT NOT NULL,
  payload_json    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  sent_at         TEXT
);
CREATE INDEX idx_outbox_pending ON email_outbox(status, next_attempt_at);

-- Who exported what, when. Compliance hygiene.
CREATE TABLE export_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_email  TEXT NOT NULL,
  dataset      TEXT NOT NULL,
  filters_json TEXT,
  row_count    INTEGER,
  exported_at  TEXT NOT NULL
);
CREATE INDEX idx_export_log_exported ON export_log(exported_at);
