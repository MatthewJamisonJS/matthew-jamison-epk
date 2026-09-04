# SEO + GSC indexing fix, and a sustainable content layer (releases · blog · email)

Workflow: Fable plans (this doc) → Opus implements phase by phase → Fable reviews each phase, iterates via Opus agent until it meets/exceeds the bar. Style harness for every new surface: `/hallmark` audit + `/frontend-design` constrained to existing tokens/classes (no new colour, no new type, no new panel system). Final prose gate on any blog copy: `/rewriting-clearly`.

## Context

matthewjamison.dev is a one-URL EPK + store (vanilla HTML/CSS/JS, Cloudflare Pages, Worker at api.matthewjamison.dev, strict CSP, no build step beyond deploy-time sed/esbuild). Google Search Console shows 11 flagged URLs across four reports. Matthew also wants the site to sustain future album releases, a blog in his own informal voice, and a self-owned email list that announces new posts/releases.

### Root cause of the GSC reports (systematic-debugging Phase 1 — done, evidence below)

All 11 flagged URLs are **legacy paths from the pre-EPK Hugo site** (`/de/ /fr/ /es/ /ja/` i18n, `/demos/`, `/demos/page/2/`, `?service=dfy|audit|setup`). Every flagged crawl date (Mar 29 – Aug 23) predates two fixes already shipped:

| Fix | Commit | Date |
|---|---|---|
| `<link rel="canonical" href="https://matthewjamison.dev/">` added | eb65b31 | 2026-08-20 |
| `404.html` added — kills Pages SPA fallback (which had served `index.html` with 200 for every missing path — hence "Alternate page with proper canonical" and "Duplicate without user-selected canonical") | d4b0a34 | 2026-08-25 |

Live today (verified with ranged GETs, browser UA): `/de/ /fr/ /fr /ja/ /es/ /demos/ /demos/page/2/` → **404** with `noindex` 404.html; `/?service=dfy` → 200 with canonical → `/`. This is the textbook-correct state. Old Hugo content is unrelated to the EPK, so **do not 301 legacy paths to `/`** (Google treats mass redirect-to-homepage as soft-404; Pages `_redirects` also cannot emit 410). Nothing to build for the GSC reports; the remaining work is validation (Phase 0).

### The real SEO gap

One indexable URL, 29 releases with no landing pages, no fresh-content signal, no owned audience. That is what Phases 1–4 fix.

## Existing assets to reuse (do not rebuild)

- **Worker double-opt-in list**: `worker/src/lib/subscribers.ts` (`recordConsent`, state machine pending→confirmed), `routes/verify.ts`, `routes/unsubscribe.ts` (RFC 8058), `lib/outbox.ts` + `scheduled.ts` (queued sending), `lib/email.ts` (`sendEmail` via Resend), `routes/admin.ts` bearer/Access auth, D1 `subscribers.consent_source` (currently only `'checkout'`). CORS/preflight pattern: `routes/checkout.ts`.
- **Release data**: `index.html:1287` `#store-data` JSON (slug → title, kind, price, tracks+durations); covers at `assets/covers/{slug}-{210,350,700}.webp`; card markup `index.html:285-301`; JSON-LD `@graph` at `index.html:16+`.
- **Blog engine assets (fork, don't run)**: `~/Code/jss_blog_creator` — voice corpus `voice/HEART.md`, `voice/VOICE.md`, `voice/exemplars/substack/*`; editorial rules + banned list `skills/editorial-voice/references/*`; slop-check logic `src/editorial.rs` (port to Python); front-matter contract from `src/commit.rs` (TOML `+++`, `draft = true`, `publish_at`); sidecar shape `src/seo_sidecar.rs` (`title, description, image, image_alt`); SEO knowledge `.claude/rules/seo-aeo.md`.
- **Scheduled publish reference**: `~/Code/jss-landing/.github/workflows/publish-scheduled.yml` + `scripts/release_scheduled.py` (stdlib Python, flips `draft=false` + sets `date` on/after `publish_at`, America/Chicago). Copy, do not reinvent.
- **Deploy**: `.github/workflows/deploy.yml` already prunes `worker docs`, sed-versions `?v=dev`, esbuild-minifies, then `wrangler pages deploy .`.

## Hard constraints (from `.claude/rules/architecture.md` + memory)

- CSP: no inline `<style>`/`<script>`/`style=`, no `innerHTML` (Trusted Types), `form-action 'none'` (forms submit via fetch to api.*). New external hosts need explicit sources — prefer none. The two `sha256` pins in `_headers` must be recomputed if `index.html` JSON-LD or `#store-data` change.
- Lowercase site aesthetic; `// comment` section labels are `<h2 class="section-label comment">`; AA tokens `--text-muted #8f8f8f`, green `#5BA36C`. First-person, humble voice; copy Matthew writes lands verbatim (content-workshop pattern).
- Lighthouse 98/100/100/100 must not regress. Headless Chrome screenshots render black — verify in a real browser.
- **Never** "royalty-free" for loops. `llms.txt` frozen — do not touch. robots.txt + sitemap.xml are the maintained surfaces.
- Cover images: `_9/_2/_16`-class sizes only (210/350/700). No 1200px.
- No AI co-author trailers in commits.

---

## Phase 0 — GSC hygiene (no code; 20 min)

1. In GSC, click **Validate Fix** on all four reports (Alternate canonical · Crawled-not-indexed · Duplicate no canonical · Not found 404). Expected outcome: legacy URLs drop out over 1–4 weeks; the 404 report may persist and is correct.
2. Re-submit `https://matthewjamison.dev/sitemap.xml` in Sitemaps.
3. Optional clean-up: add `/games/_test/` to the deploy prune step (it is live at 200, header-noindexed — harmless, but it is test scaffolding).

Fable review: confirm the four "Validate" states show "Started".

---

## Phase 1 — Release pages `/music/<slug>/` (the biggest ranking surface)

**Why**: 29 indexable, intent-matched URLs (`matthew jamison <album>`, `<album> bass instrumental`), each with `MusicAlbum` rich-result schema, cover, tracklist, buy button. Sustains every future release: add one JSON entry + 3 cover webps, push.

**Data**: new `data/releases.json` — canonical release list, seeded by a one-off script from `#store-data` (slug, title, kind, price, tracks) plus fields the block lacks: `released` (ISO date, Matthew supplies), `blurb` (Matthew's words, optional), `credits` (optional). `index.html` keeps its own `#store-data` for now (both hash-pinned; unifying them is a follow-up, noted not built).

**Generator**: `scripts/build.mjs` (Node, no deps beyond `marked` for Phase 2; run via `npx --yes` at deploy, runnable locally for preview). Emits:

- `/music/<slug>/index.html` — same shell as `thanks/index.html` (url-bar, `.section`, `.page-orb`, footer), `<h1>` title, `kind · price`, cover `<picture>` 350/700, tracklist `<ol>` with durations, `→ buy` button (POST `/checkout {slug}` via a small `release.js` extracted from the checkout path in `script.js` — no player on v1), "← all releases" link to `/#catalog`, `<link rel="canonical">`, OG tags (cover as `og:image`), meta description from blurb or a templated sentence, JSON-LD `MusicAlbum` (+`byArtist` → `#matthew-jamison` `@id`, `Offer`, `track` list, `image`, `datePublished`).
- `/music/index.html` — plain index of all releases (newest first) — gives crawlers a hub; nav gets no new item (minimalism rule) — link from the catalog `// label` line.
- `sitemap.xml` — regenerated: `/`, `/music/`, every release (lastmod = `released` or file mtime), image entries per release cover.
- Catalog cards in `index.html`: `.store-title` becomes an `<a href="/music/<slug>/">` (internal linking; keeps visible text identical; accessibility name unchanged).

**CSP + JSON-LD**: implementer must verify in a real browser whether an unhashed `application/ld+json` block triggers a CSP report under this policy (non-executable script types are exempt from the script-src fetch check per the HTML spec, which is why Lighthouse never flagged them). If no violation → release pages ship JSON-LD unhashed and `architecture.md` gets the correction. If a violation appears → generator appends the per-page hashes to the `/*` `script-src` in `_headers` (header stays well under limits at 30–60 pages; per-path rules would hit the 100-rule cap).

**Deploy**: `deploy.yml` adds `node scripts/build.mjs` before minify; prune list gains `scripts data content`. Generated output is not committed (deploy-time render, same posture as the existing sed/esbuild).

Style harness: `/hallmark` audit of one release page against `/` in a real browser; identical tokens, no new components; mobile word-wrap rules from memory (no mid-word breaks).

Acceptance (BDD):
- Given `data/releases.json` has `the-journey`, When the site deploys, Then `https://matthewjamison.dev/music/the-journey/` returns 200, has one `<h1>the journey</h1>`, a 13-item tracklist, a canonical to itself, and a `MusicAlbum` JSON-LD that passes Google's Rich Results Test.
- Given a buyer on a release page, When they click `→ buy`, Then they land on Stripe Checkout for that slug (same Worker route as the catalog).
- Given the sitemap, When fetched, Then it lists `/`, `/music/`, and every release with a `lastmod`.
- Lighthouse on `/` unchanged (98/100/100/100); release page ≥ 95 perf.

---

## Phase 2 — Blog `/blog/` + a Claude-Code writing kit (no Rust), in Matthew's voice

**Why**: freshness signal + long-tail on the owned domain, about **whatever Matthew wants to write** (gear, process, faith, family, SP-404, session stories). Substack stays as-is and remains linked in contact.

**Decision (Matthew, Sep 4)**: do not run `blogctl`. Fork its *assets* (voice corpus, editorial rules, banned list, brief shape, SEO sidecar idea, scheduled-publish flow) into a lightweight kit that Claude Code drives session by session. Equal efficiency, zero binary, no topic constraint.

**Kit repo**: `~/Code/mj-writing-room/` (alternatives: `mj-notes`, `wwjd-writing-room` — Matthew picks the name at Phase 2 start). Contents:

- `.claude/rules/` — `voice.md` (copied from `jss_blog_creator/voice/HEART.md` + `VOICE.md` internal register), `editorial.md` (from `skills/editorial-voice/references/{voice-rules,banned-list,writing-to-people}.md`), `publishing.md` (front-matter contract, publish flow, EPK repo path), `seo.md` (trimmed from `.claude/rules/seo-aeo.md`: title/meta/slug/heading rules, "no `llms.txt` as lever", passage-citability).
- `voice/exemplars/substack/*` copied verbatim (never edited, only re-scraped).
- `.claude/skills/note/SKILL.md` — one skill, four stages, each ends at a human gate:
  1. `/note new <working title>` → creates `drafts/<slug>/draft.md` (body only) + `brief.md`: Matthew's take (mandatory, his words), optional keyword/SERP angle pulled with the existing `claude-seo:seo-page` / `seo-content-brief` skills **only if he wants search intent for this post**; personal posts skip SEO research entirely.
  2. `/note write` → Matthew writes; Claude is an editor, not the author (asks, suggests cuts, never drafts body prose unless asked). `scripts/slop.py` (banned-list scan ported from `editorial.rs`) and `scripts/links.py` (dead-link check) run on demand. Fact gate is **advisory**: stats/dates get a source or a visible `[needs source]`, opinion and story need nothing.
  3. `/note review` → **`/rewriting-clearly` is the final prose gate** (Zinsser: tighten, keep voice). Then `scripts/sidecar.py` writes `<slug>.seo.json` (`title`, `description`, `image`, `image_alt`) from Matthew's approved lines; `title`/`description` length checks.
  4. `/note ship --publish-at YYYY-MM-DD` → `scripts/ship.py` renders TOML front matter (`title, date, publish_at, draft = true, description, image, image_alt, tags`), copies `draft.md` → `~/Code/matthew-jamison-epk/content/blog/<slug>.md` (+ cover webp → `assets/blog/`), one git commit in the EPK repo, no push unless asked. Refuses to overwrite a post that is already `draft = false` (same footgun as blogctl). Never writes `draft = false`.
- Cover: optional; a bare card is fine for short notes.

**Site side** (EPK repo):
- Copy `publish-scheduled.yml` + `release_scheduled.py` from jss-landing (adjust the deploy job to this repo's `pages deploy` steps). Cron flips `draft=false` on the date, commits, deploys.
- `release_scheduled.py` `DEFAULT_CONTENT_DIR` → `content/blog/`.
- `scripts/build.mjs` gains: read `content/blog/*.md` where `draft = false`, render Markdown → HTML with `marked` (sanitised, no raw HTML passthrough, no inline styles), emit `/blog/<slug>/index.html` (same shell; `<h1>` from front matter; date; body; canonical; OG from sidecar `image`/`image_alt` when present), `/blog/index.html` (list newest-first, one-line dek), `feed.xml` (RSS 2.0, full text, 20 items), sitemap entries. `Article` JSON-LD with `author` → Person `@id`.
- `<link rel="alternate" type="application/rss+xml" href="/feed.xml">` in `index.html` head and blog pages.

**Layout parity with jss-landing (Matthew, Sep 4)** — mirror the *structure* of `~/Code/jss-landing/layouts/blog/{section,page}.html` + `_partials/{author-card,post-share}.html`, re-skinned in EPK tokens (dark glass, JetBrains Mono, lowercase labels, `--text-muted`, green accent). Live reference for the real-browser hallmark comparison: `https://gatewaytechaeo.com/blog/`. No jss CSS is copied; classes are re-implemented in `style.css` (or a lazily-loaded `blog.css`, cached like `style.css`).
- **Listing `/blog/`**: `<h1>` + one short dek (Matthew's words); flat newest-first `<ul role="list">` of cards — optional cover thumb (800×450 webp), `<h2>` title, meta line `date · N min read · topic`, one-line description; pager `← newer / older →` at 10/page.
- **Post `/blog/<slug>/`**: `.post-header` (`<h1>`, meta `date · read time · by matthew jamison`); **left rail** = author card, then Contents `<details open>` only when the post has ≥ 5 headings (H2–H4); `.article.prose` body; **end strip** spanning both columns = share cubes (Facebook + LinkedIn intent links + copy-link button revealed only when Clipboard API exists — plain anchors, no SDKs, no CSP change), the **Phase 3 subscribe card**, `← all notes`. Desktop ≥ 1024px two-column grid with sticky rail; mobile single reading column.
- **Author card**: avatar (below), name, one-line role (`session bassist · producer · dev`), 2-line bio in Matthew's words, `rel="me"` links (GitHub, Substack) with sr-only anchor text.
- **Avatar** = `/Users/wwjd_._/Downloads/MatthewJamisonJScoding-optimized.mp4` (h264 800×800, 24fps, 5.04s, 1.2MB — too heavy as-is). Transcode with ffmpeg to 240×240 (2× the 120px render), h264 + webm, target ≤ 150KB, `<video autoplay muted loop playsinline preload="metadata" poster=…>` served from `assets/blog/` (`media-src 'self'` already allows it). `prefers-reduced-motion` → video not loaded, poster shown (same rule as the hero video in `script.js`). Poster/fallback = the car selfie Matthew sent (Sep 4) — source saved at `~/Downloads/matthew-avatar-source.jpeg`, squares it on the face, exports `avatar-240.webp` + `avatar-120.webp`. If the looping video reads as distracting in the hallmark pass, the still becomes the default and the video is dropped — Matthew's stated fallback.
- Article JSON-LD `author` → the existing Person `@id`, `image` → avatar still.
- Home page surface: a **minimal** `// notes` block near the bio/process cluster listing the latest 3 post titles as plain links (no text walls — SEO-minimalism memory). Keep the id stable (`#notes`), no nav item.

Acceptance:
- Given a shipped post (`/note ship`) with `publish_at = today` and `draft = true`, When the scheduled workflow runs, Then the post is flipped, deployed, live at `/blog/<slug>/`, in `/blog/`, `feed.xml`, and `sitemap.xml`.
- Given a post with `draft = true` and a future date, When deploy runs, Then no `/blog/<slug>/` exists and the workflow log warns about the unscheduled/future draft.
- Given `/blog/<slug>/`, When loaded in Chrome with DevTools open, Then zero CSP violations.

---

## Phase 3 — Self-owned email list (subscribe form → Worker → Resend)

**Worker**:
- `POST /subscribe` `{ email, website }` (`website` = honeypot; non-empty → 200 no-op). Normalise via existing token helper, call `recordConsent(env, email, null, country)` with `consent_source = 'site'` (schema `CHECK` if any needs widening — new forward-only migration `0003_*.sql`). Re-uses `verify_subscription` outbox mail → `/verify/:token` → confirmed. Response is always `202 {ok:true}` (no enumeration). CORS mirrors `/checkout` (origin allowlist). Rate limit: per-IP counter (KV or D1) 5/hour — Turnstile deliberately not used (would add `challenges.cloudflare.com` to CSP).
- `POST /admin/broadcast` (bearer/Access, same guard as `/admin/export`) `{ subject, text, html?, url }` → enqueue one outbox row per `status='confirmed'` subscriber with the existing unsubscribe link/headers. Idempotency key on `(subject, date)`. Dry-run flag returns the recipient count only.
- `scripts/announce.sh` template: `op read` the bearer, curl the broadcast route. Manual trigger for now (YAGNI on auto-announce; noted as follow-up: deploy job posts a broadcast when a new release/blog slug appears).

**Site**:
- Subscribe block in `#contact` (one line label `// get new music + notes by email`, one email input, one `→ subscribe` button, one status line). `<form novalidate>` intercepted in `script.js`; fetch POST; success copy in Matthew's words (content-workshop write-in); error state AA-contrast. Labelled input, `aria-live` status, no placeholder-as-label.
- Verify page (`/verify/:token`) already exists on the Worker; confirm its HTML matches the site shell tokens (hallmark check) or link back to `/`.

Acceptance:
- Given a visitor enters a valid email, When they submit, Then a confirmation email arrives, clicking it sets `status='confirmed'`, and re-submitting the same email returns 202 without a second row.
- Given a filled honeypot or 6th submit in an hour from one IP, When submitted, Then 202 and no row/email.
- Given 3 confirmed subscribers, When `/admin/broadcast` runs with `dry_run`, Then it reports 3 and sends nothing; without `dry_run`, 3 outbox rows, each with `List-Unsubscribe` headers.

---

## Phase 4 — Fable review + optimisation loop

For each phase, Fable runs: real-browser hallmark audit vs `/`, Lighthouse (mobile) on `/` and one new page, Rich Results Test on one release + one post, `curl` header/CSP diff, GSC URL Inspection → Request Indexing for `/music/`, three releases, `/blog/`. Findings go back to an Opus agent as a single ranked list; iterate until Lighthouse ≥ 95 on new pages and zero CSP violations.

## Files touched (representative)

- New: `data/releases.json`, `scripts/build.mjs`, `scripts/seed-releases.mjs` (one-off), `scripts/release_scheduled.py`, `.github/workflows/publish-scheduled.yml`, `release.js`, `content/blog/` (written only by the kit's `ship.py`), `worker/src/routes/subscribe.ts`, `worker/src/routes/broadcast.ts`, `worker/migrations/0003_consent_source_site.sql`, `scripts/announce.sh`, `assets/blog/avatar-{240,120}.webp` + `avatar-240.{mp4,webm}`, optional `blog.css`.
- Edited: `index.html` (card title links, `// notes` block, subscribe form, RSS link — recompute both `_headers` hashes if the JSON blocks change), `script.js` (subscribe fetch), `style.css` (form + list styles from existing tokens only), `_headers` (optional hash additions; `/blog/*` `/music/*` inherit `/*`), `sitemap.xml` (becomes generated), `.github/workflows/deploy.yml` (build step + prune list), `worker/src/index.ts` (routes), `worker/src/types.ts`, `.claude/rules/architecture.md` (document the content layer, generator, and JSON-LD CSP finding).
- Untouched on purpose: `llms.txt`, `robots.txt`, `404.html`, games.

## Spec + plan docs

This file is the design spec. Per-phase implementation plans live under `docs/superpowers/plans/2026-09-04-content-layer-p{1,2,3}.md`, written by the implementer at the start of each phase.

## Verification (end-to-end)

1. `node scripts/build.mjs` locally → `python3 -m http.server` → open `/music/the-journey/`, `/blog/`, `/` in Safari/Chrome; check console for CSP reports (headers are edge-only, so also test on a Pages preview deploy).
2. `curl -s -A Mozilla -o /dev/null -w '%{http_code}'` on: `/music/`, `/music/the-journey/`, `/blog/`, `/feed.xml`, `/sitemap.xml`, and the legacy `/de/` (must stay 404).
3. Rich Results Test + Schema validator on one release, one post.
4. Worker: `npx vitest` in `worker/` (add specs for `/subscribe` honeypot, dedupe, broadcast dry-run); `wrangler deploy`; live `POST /subscribe` with a test inbox; confirm; `/admin/export` shows `consent_source=site`.
5. Lighthouse mobile on `/` (must stay 98/100/100/100) and on one release + one blog page.
6. GSC: sitemap re-submitted, Validate Fix started ×4, Request Indexing on the hub pages.

## Decisions locked with Matthew (Sep 4 2026)

- Blog is native `/blog/` on the site; Substack stays linked. Authoring via a new Claude-Code writing kit (`~/Code/mj-writing-room/`, name TBD by Matthew) forked from jss_blog_creator's assets — no Rust binary, any topic, Matthew writes the body, `/rewriting-clearly` is the final gate.
- Email list is self-owned (Worker + D1 + Resend), reusing the existing double-opt-in; broadcasts via an admin route.
- Legacy Hugo URLs stay 404 (no redirect-to-home). GSC work is validation only.
