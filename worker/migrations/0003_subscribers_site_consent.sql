-- Site-form consent (Phase 3) + the two tables it needs.
--
-- Forward-only, additive. Nothing here rebuilds an existing table.
--
-- On `consent_source = 'site'` and a NULL album: NO CHANGE IS NEEDED.
-- 0001 declares `consent_source TEXT NOT NULL` with no CHECK constraint (the
-- `-- 'checkout'` there is a comment, not an enum), and `first_album_slug TEXT`
-- is already nullable. So a site-sourced row with no album inserts as-is. This
-- file exists for the rate-limit and broadcast tables below; the widening it is
-- named for was already legal.

-- Per-IP submit counter for POST /subscribe. D1 rather than KV: there is no KV
-- namespace on this Worker, and a counter that must be correct within the hour
-- does not want KV's eventual consistency. One row per IP per window; the
-- nightly cron sweep can delete stale windows.
CREATE TABLE ip_rate (
  key          TEXT PRIMARY KEY,   -- '<route>:<ip>'
  count        INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL       -- ISO8601; window is [start, start + 1h)
);
CREATE INDEX idx_ip_rate_window ON ip_rate(window_start);

-- Broadcast idempotency + audit. UNIQUE(subject, sent_on) is the whole point:
-- a re-run of scripts/announce.sh on the same day with the same subject must
-- not mail the list twice. The insert happens BEFORE the outbox rows, so a
-- crash mid-enqueue still blocks the duplicate rather than doubling it.
CREATE TABLE broadcasts (
  id              TEXT PRIMARY KEY,
  subject         TEXT NOT NULL,
  sent_on         TEXT NOT NULL,   -- YYYY-MM-DD, UTC
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  UNIQUE (subject, sent_on)
);
