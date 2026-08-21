-- Catalog seed. EDIT BEFORE RUNNING.
--
-- Every stripe_price_id below is a placeholder. Create one Stripe Product per
-- release with one one_time Price, set tax_behavior = exclusive ON THE PRICE
-- (irreversible), set metadata.album_slug on the Product to match `slug`
-- exactly, then paste the real price_... ids here.
--
-- Price tiers (cents): single 299 / ep 599 / album 999.
-- price_cents is display + audit only; Stripe is the authority on the charge.
--
--   wrangler d1 execute mj-music --local  --file=./seed-albums.sql
--   wrangler d1 execute mj-music --remote --file=./seed-albums.sql

INSERT OR REPLACE INTO albums
  (slug, title, kind, price_cents, stripe_price_id, r2_key_wav, r2_key_mp3, active)
VALUES
  ('example-single', 'Example Single', 'single', 299,
   'price_REPLACE_ME_SINGLE',
   'albums/example-single/example-single-wav.zip',
   'albums/example-single/example-single-mp3-320.zip', 1),

  ('example-ep', 'Example EP', 'ep', 599,
   'price_REPLACE_ME_EP',
   'albums/example-ep/example-ep-wav.zip',
   'albums/example-ep/example-ep-mp3-320.zip', 1),

  ('example-album', 'Example Album', 'album', 999,
   'price_REPLACE_ME_ALBUM',
   'albums/example-album/example-album-wav.zip',
   'albums/example-album/example-album-mp3-320.zip', 1);
