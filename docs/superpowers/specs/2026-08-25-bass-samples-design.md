# Bass Sample Packs — store section, delivery, SEO, security

## Context

Matthew has two finished bass sample packs in `/Users/wwjd_._/Downloads/SAMPLE_PACKS`:

- **INFINITY LOOPS** — 50+ original bass grooves, 24-bit stereo WAVs (full + 1-bar variants) + `Master Clearance Agreement.txt`, ~289MB. Cover: `INFINITY LOOPS/MatthewJamisonBassSamplePack_InfinityLoop.png` (2000×2000).
- **BASS SAMPLE PACK VOL. 1 [LATIN EDITION]** — 91 bass fills, 47 one shots, 18 slides & more, ~252MB. Cover: `BASS SAMPLE PACK VOL. 1 [LATIN EDITION]/BASS SAMPLE PACK.jpeg`.

Goal: sell on matthewjamison.dev — **$20 each, $35 bundle** — through the existing store pipeline (Worker `worker/` at api.matthewjamison.dev: D1 `mj-music`, private R2 `mj-albums`, Stripe Checkout live, Resend token delivery). New page section styled like the games grid, same CSP/security bar as the catalog, SEO/metadata pass targeting bass-sample-pack + indie-artist keywords. Premium visual polish (hallmark + frontend-design triple-pass). Verified locally in a real browser with Stripe **test mode** — no live payment.

Decisions made with Matthew (approved via Q&A):
- Bundle delivery: **one landing page, two zips** (no combined zip).
- Placement: **own `// bass samples` section after games**, own nav link.
- Previews: **self-hosted clips** curated from his SoundCloud demo playlists; **no external embeds** (CSP stays strict).
- Backend mapping: **reuse the two R2 key columns + widen `kind` CHECK** (see §3).
- Bundle art: **composite of the two covers**, approved in browser before merge.
- Copy: **facts-only from the covers** — no drafted prose; anything more goes through content-workshop later.
- Stripe products created at implementation time (live via Stripe MCP/API; test-mode twins for verification).
- **robots.txt is the priority discovery surface. llms.txt gets ONE final update, then is frozen** — amend `.claude/rules/architecture.md` to retire the "update llms.txt on every copy change" rule (file stays deployed).

Preview curation sources (tracklists are JS-rendered — read at implementation time with superpowers-chrome local Chrome CDP, then match titles to local WAV filenames):
- Infinity Loops: https://soundcloud.com/matthew-j-jamison/sets/infinity-loops-sample-pack
- Latin Vol. 1 (secret link): https://soundcloud.com/matthew-j-jamison/sets/bass-sample-pack-demo/s-crmvyTgDHvP

## Key exploration facts (verified)

- Delivery layer is already zip-based. `/checkout` reads price from Stripe via `stripe_price_id` (D1 `price_cents` is display/audit only). Metadata `album_slug` on session AND payment_intent.
- Blockers for trackless/zip-only products:
  - `worker/migrations/0001_initial_schema.sql:12` — `kind CHECK (kind IN ('single','ep','album'))`; SQLite CHECK can't be ALTERed → table rebuild migration needed.
  - `r2_key_wav`/`r2_key_mp3` both NOT NULL; `/d/:token/file` hard-requires `?format=wav|mp3` (`worker/src/routes/download.ts:151-157`); key map `r2KeyFor()` in `worker/src/lib/db.ts:31-33`.
  - Landing `okBody()` (`download.ts:83-96`) and `downloadReady()` email (`worker/src/lib/email.ts:115-152`) hardcode "both formats — WAV and MP3 320".
  - Frontend: `.store-play` button is unconditional per card; `tr: []` makes it a silent dead button (`script.js:390-393`, `452`).
- Existing public preview route `GET /p/:slug/:NN` → `previews/{slug}/{NN}.mp3` (`worker/src/routes/preview.ts`) — works for pack demo clips with zero worker changes. `/s/` FLAC simply 404s for packs (correct if no play button without tracks — guard fixes this).
- `/admin/mpu` (`worker/src/routes/upload.ts`) key regex `^albums\/[a-z0-9-]+\/[A-Za-z0-9._ -]+$` — pack zips must live under `albums/{slug}/`.
- Download counting: atomic `consumeDownload()` (`db.ts:74-86`), cap 5 per token (`MAX_DOWNLOADS` in `wrangler.jsonc:72`), landing consumes nothing, one consume per `/file` hit — bundle "5 shared downloads across both zips" works as-is.
- `_headers` CSP: api.matthewjamison.dev already in `connect-src` + `media-src`; two sha256 pins (JSON-LD + `#store-data`) must be recomputed on edit (recompute script is in `_headers` comment).
- Games tile pattern: `index.html:813-876`; store card pattern: `index.html:159+`; store-data JSON blob: `index.html:1006`.

## Plan

### A. Assets (local prep)
1. Zip each pack preserving folder structure + Master Clearance Agreement → `infinity-loops-wav.zip`, `bass-latin-vol-1-wav.zip` (work in scratchpad).
2. Covers → webp srcset 210/350/700 in `assets/covers/`: `infinity-loops-*.webp`, `bass-latin-vol-1-*.webp`. Build bundle composite from both covers → `bass-samples-bundle-*.webp`; show Matthew in browser for approval.
3. Read both SoundCloud playlists via superpowers-chrome; match demo titles → local WAVs; encode ~15–30s 128k MP3 clips → `previews/{slug}/NN.mp3` (bundle plays a merged selection, no separate clips needed if `tr` references its own uploaded set — simplest: give bundle its own small merged clip set).

### B. Worker (`worker/`)
4. Migration `0002`: rebuild `albums` widening CHECK → `kind IN ('single','ep','album','pack','bundle')`; all columns preserved (additive on values). Apply local + live.
5. Seed rows (test + live seeds): `infinity-loops` (pack, 2000¢, zip in both key cols), `bass-latin-vol-1` (pack, 2000¢, dup), `bass-samples-bundle` (bundle, 3500¢, wav-slot=Infinity zip, mp3-slot=Latin zip).
6. `download.ts`: branch landing by kind — pack: one button "download pack (wav)"; bundle: two buttons labeled "infinity loops" / "bass sample pack vol. 1 (latin edition)". Filename + `formatLabel` branch by kind. `types.ts` `Format` union unchanged.
7. `email.ts` `downloadReady()`: kind-aware copy (no "both formats" claim for pack/bundle; bundle says both packs on one page, 5 downloads shared).
8. New vitest cases: kind CHECK accepts pack/bundle; landing renders 1 vs 2 buttons; bundle format=wav|mp3 maps to the two different zips; email copy branches.
9. Stripe: create 3 **live** products/prices via Stripe MCP ($20/$20/$35, exclusive-tax to match existing) + 3 **test-mode** twins; put test price IDs in local/dev seed. Set `stripe_price_id` per row.
10. Upload zips + preview mp3s to R2 via authed `/admin/mpu` recipe (memory: project-store-changes-aug22; UA header required; keys under `albums/{slug}/` and `previews/{slug}/`).

### C. Frontend (`index.html`, `style.css`, `script.js`)
11. New section after games: `<section id="samples">`, `<h2 class="section-label comment">// bass samples …</h2>`, nav link added. Three tiles: games-grid visual language (art-forward), store-card function — cover srcset, name, `sample pack · $20.00` / `bundle · $35.00` meta, facts line (verbatim: "over 50 original bass grooves"; "91 bass fills, 47 one shots, 18 slides & more"), preview play, buy button reusing existing checkout JS (`script.js:494-515`).
12. `#store-data` JSON: add 3 entries with `tr` arrays for the preview clips.
13. `script.js`: guard — omit/disable play affordance when `tr` empty (also fixes latent dead-button bug). No innerHTML anywhere (Trusted Types enforced).
14. Recompute BOTH sha256 hashes (JSON-LD + store-data) in `_headers` — script in `_headers` comments.
15. **Hallmark + frontend-design triple-pass**: implement → screenshot in real browser (headless renders black — use superpowers-chrome against local server) → critique → refine, ×3. Mobile + desktop, light/dark n/a (single dark design), Reduce Motion respected.

### D. SEO / metadata (research-backed via DataForSEO)
16a. Locate Matthew's DataForSEO credentials in 1Password (`op item list` search "DataForSEO", vault `Private`, `--account my.1password.com`; read via `op read`, inject via subshell env — never echo). Query DataForSEO Labs/keyword endpoints for search volume + related keywords around seeds: "bass sample pack", "bass loops", "bass one shots", "bass fills", "latin bass samples", "indie artist sample pack", "royalty free bass loops". Pick the highest-value combination that stays honest (royalty-free claim only if the Master Clearance Agreement supports it — read it first).
16b. Meta description rewritten from that data, combined with existing session-bassist positioning. No keyword stuffing; one description, ≤160 chars.
17. JSON-LD: add `Product` entries (name, image, offers USD price, seller Matthew Jamison) — recompute hash (same step as 14).
18. `sitemap.xml`: lastmod bump + `<image:image>` entries for pack covers.
19. `robots.txt`: verify current allow-all + AI crawler stanzas intact (priority surface; no changes expected — confirm Cloudflare dashboard state per rules if crawler 200s matter).
20. `llms.txt`: ONE final update mirroring the new section verbatim, then **amend `.claude/rules/architecture.md`** — AI-surfacing paragraph now says llms.txt is frozen as of Aug 2026, do not update further; robots.txt + sitemap.xml are the maintained surfaces.

### E. Security / a11y pass (wcag-security) — best practices + edge cases for selling
21. Site: CSP unchanged (no new hosts), Trusted Types intact, both sha256 pins recomputed. Tiles: AA contrast tokens, visible focus states, accessible name from visible text (games convention: `alt=""`, no aria-label). Run wcag-security checklist on the new section.
21b. Worker sell-path edge cases — verify existing protections cover the new products and add tests where missing:
   - **Landing-page headers**: `/d/:token` HTML is served from the worker, NOT covered by Pages `_headers` — confirm/add security headers (CSP, nosniff, frame-ancestors 'none', referrer-policy) on worker HTML responses.
   - **Format-param manipulation on a pack**: `?format=mp3` on a pack serves the same zip (dup key) — acceptable, but assert it counts a download and never 500s; landing shows only one button.
   - **Bundle partial refund/dispute**: refund on the bundle PI revokes the token → BOTH zips inaccessible (existing `revokeByPaymentIntent`) — test.
   - **R2 object missing** for one bundle zip: `refundDownload()` gives the count back — test for the mp3-slot branch.
   - **Token exhaustion split**: 5 shared downloads across two zips — 6th refused regardless of which file; reissue cap of 4 still applies.
   - **Preview leakage**: `/p/` is public by design — upload only short clips (~15–30s, 128k), never full-resolution full-length loops; verify no `stream/{slug}/` FLAC objects exist for packs.
   - **Slug/price integrity**: price always from `stripe_price_id` (no client amount); new slugs pass `SLUG_RE`; live/test price IDs never cross (existing livemode guard on webhook — test the guard against a test event).
   - **Admin surface**: `/admin/mpu` key regex confines writes to `albums/`; bearer/Access auth unchanged; secrets only via `wrangler secret put` pipes / `op run` — never echoed.
   - **Webhook hygiene** (existing, re-verify in tests): signature verify order, dedupe claim/release, one-token-per-purchase idempotency under Stripe retries.

### F. Verification (no live payment) — /verification-before-completion
22. Worker: full vitest suite green. `wrangler dev` + test-mode keys: POST /checkout returns a test Checkout URL; `stripe trigger checkout.session.completed` (test) → outbox email row + token minted → `/d/:token` shows correct buttons per kind → `/file?format=…` streams correct zip and decrements counter; 6th download refused.
23. Site: local static server + real browser. Tiles render, previews play via `/p/`, buy button reaches Stripe test checkout, zero console CSP/TT violations. Note `_headers` not applied locally — CSP behavior re-checked on a preview deploy.
24. Lighthouse (local, mobile emulation) ≥ 98/100/100/100 baseline.
25. Execution workflow per Matthew: Opus subagent(s) implement from this plan with review/feedback loop (code-reviewer between passes) until browser-verified; Fable orchestrates.

### Commit/merge gates
- Bundle composite art approved by Matthew in browser before merge.
- Any prose beyond cover-verbatim facts → content-workshop, not drafted.
- Live Stripe product creation + live R2 upload + live D1 migration are outward-facing: confirm with Matthew immediately before those specific steps.

## BDD scenarios

```
Story: Buy a sample pack
  Given the site served locally with test-mode Stripe
  When a visitor clicks buy on the infinity loops tile
  Then a Stripe Checkout session opens priced $20 for that product

Story: Bundle delivery
  Given a completed test-mode bundle purchase
  When the buyer opens their /d/:token page
  Then two labeled downloads appear (infinity loops, latin vol. 1)
  And each consumes one of the 5 shared downloads

Story: Tile preview
  Given a pack tile with preview clips
  When a visitor presses play
  Then a clip streams from /p/ through the shared player with no CSP violations
```
