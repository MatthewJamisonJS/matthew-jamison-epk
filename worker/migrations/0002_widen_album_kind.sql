-- Widen albums.kind to admit sample packs and bundles.
--
-- Additive in VALUES, not in columns: every column, type and constraint below
-- is byte-identical to 0001 except the CHECK list, which gains 'pack' and
-- 'bundle'. SQLite cannot ALTER a CHECK constraint, so the table is rebuilt.
--
-- There is no BEGIN/COMMIT below, and adding one would break this file: D1
-- rejects explicit transaction statements. It does not need them. `wrangler d1
-- migrations apply` sends each migration file as a single D1 batch, and a batch
-- IS a transaction -- any statement failing rolls the whole sequence back
-- (developers.cloudflare.com/d1/worker-api/d1-database/, batch() section). So
-- the DROP TABLE -> RENAME window below is never observable half-applied: the
-- four statements land together or not at all.
--
-- Safe to rebuild: nothing references albums by foreign key. purchases.album_slug
-- and download_tokens.album_slug are plain TEXT columns, not FK references, so
-- dropping and recreating the table cannot orphan or cascade anything.
--
-- 'pack'   -- a sample pack. One zip, sold on its own. Both r2 key columns hold
--             that same key, because a pack has no second format.
-- 'bundle' -- two packs sold together. r2_key_wav and r2_key_mp3 point at the
--             two pack zips; there is no third combined file.

CREATE TABLE albums_new (
  slug            TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('single', 'ep', 'album', 'pack', 'bundle')),
  price_cents     INTEGER NOT NULL,
  stripe_price_id TEXT NOT NULL UNIQUE,
  r2_key_wav      TEXT NOT NULL,
  r2_key_mp3      TEXT NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1
);

INSERT INTO albums_new
  (slug, title, kind, price_cents, stripe_price_id, r2_key_wav, r2_key_mp3, active)
SELECT
  slug, title, kind, price_cents, stripe_price_id, r2_key_wav, r2_key_mp3, active
FROM albums;

DROP TABLE albums;

ALTER TABLE albums_new RENAME TO albums;
