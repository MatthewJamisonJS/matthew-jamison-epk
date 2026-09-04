# Phase 2 (blog) + Phase 3 site side (subscribe form) — implementation plan

Spec: `docs/superpowers/specs/2026-09-04-content-layer-design.md` § "Phase 2" and
§ "Phase 3 → Site". Branch: `content-layer`. Commit locally, no push, no merge,
no edits under `worker/`.

## Acceptance scenarios (BDD — from the spec)

**Phase 2**

1. **Given** a shipped post (`/note ship`) with `publish_at = today` and
   `draft = true`, **when** the scheduled workflow runs, **then** the post is
   flipped to `draft = false`, deployed, and live at `/blog/<slug>/`, listed in
   `/blog/`, present in `feed.xml`, and present in `sitemap.xml`.
2. **Given** a post with `draft = true` and a future `publish_at`, **when**
   deploy runs, **then** no `/blog/<slug>/` exists and the scheduled workflow
   log warns about the unscheduled/future draft.
3. **Given** `/blog/<slug>/`, **when** loaded in Chrome with DevTools open,
   **then** zero CSP violations.
4. Lighthouse on `/` unchanged; a post page ≥ 95 performance.

**Phase 3 (site half only — the Worker routes already exist and are not touched)**

5. **Given** a visitor enters a valid email in the subscribe form, **when** they
   submit, **then** the form POSTs JSON to
   `https://api.matthewjamison.dev/subscribe` and shows the success line on any
   2xx, the error line on a network failure or 4xx.

Outer loop = `scripts/build.test.mjs`, extended. 1/2 are asserted mechanically
against fixture posts; 3/4/5 are verified in a real browser behind the real
`/*` CSP header, with a local stub Worker returning 202 (the live route is not
deployed yet — wiring it live is Fable's step).

## Steps

1. **Plan + avatar.** This doc. Then transcode
   `~/Downloads/MatthewJamisonJScoding-optimized.mp4` → `assets/blog/avatar-240.mp4`
   (h264) + `.webm` (vp9), 240×240, no audio, faststart, ≤150KB each; square-crop
   `~/Downloads/matthew-avatar-source.jpeg` on the face → `avatar-240.webp` +
   `avatar-120.webp` (the poster and the no-video fallback).
2. **Failing tests first.** `scripts/build.test.mjs` grows a blog block that runs
   the generator against two fixture posts in a temp content dir
   (`--content <dir> --out <dir>`): one 3-line note, one long post with 6
   headings + cover + lists + quote + code, plus a `draft = true` post that must
   never appear. It fails before step 3 exists.
3. **Generator.** `scripts/build.mjs` gains, all zero-dep:
   - a flat TOML front-matter parser (`key = value`, quoted strings, arrays,
     bare dates, booleans, ints) — no nested tables needed;
   - a safe Markdown subset renderer: ATX headings (with slugged ids),
     paragraphs, `*em*`/`**strong**`, links, images with alt, blockquote, `ul`,
     `ol`, code spans, fenced code, `hr`. Everything else is escaped. **No raw
     HTML passthrough**, no inline styles — the CSP forbids both;
   - `blog/<slug>/index.html`, `blog/index.html` + `blog/page/N/` at 10/page,
     `feed.xml` (RSS 2.0, 20 newest, full HTML in CDATA), sitemap entries;
   - the `// notes` block rendered into `index.html` between
     `<!-- notes:start -->` / `<!-- notes:end -->` markers (omitted entirely at
     zero posts). The two hash-pinned JSON blocks in `index.html` are not
     touched, so neither `_headers` hash moves.
   - Reading time = `ceil(words / 200)`, minimum 1.
4. **Blog page shape** (structure mirrored from
   `~/Code/jss-landing/layouts/blog/{page,section}.html` +
   `_partials/{author-card,post-share}.html`, re-skinned in EPK tokens — no jss
   CSS is copied): `.post-header`, left rail = author card then a Contents
   `<details open>` **only** at ≥ 5 H2–H4 headings, `<article class="article prose">`,
   an end strip spanning both columns (share cubes → subscribe card → `← all notes`).
   Desktop ≥ 1024px two-column grid with a sticky rail; mobile one column.
5. **Scripts.** `subscribe.js` (one implementation, loaded by both `/` and blog
   pages) and `blog.js` (reduced-motion avatar handling + the copy-link cube).
   `textContent` only, no `innerHTML` — Trusted Types is enforced.
6. **CSS.** `style.css` gains the blog vocabulary from existing tokens only; a
   `.sr-only` utility and a `.visually-hidden` honeypot wrapper (a class, not an
   inline style — `style=` is CSP-forbidden).
7. **index.html.** RSS `<link rel="alternate">`, the notes markers, and the
   subscribe form in `#contact`.
8. **Deploy.** `deploy.yml` sed + minify gain `blog.js` and `subscribe.js`; the
   generator must succeed with `content/` absent or empty (then `/blog/` renders
   its empty state and `feed.xml` ships zero items, so both URLs exist).
9. **Scheduled publish.** `.github/workflows/publish-scheduled.yml` +
   `scripts/release_scheduled.py`, copied from jss-landing, content dir
   `content/blog`. The release job commits and **pushes**; `deploy.yml` already
   fires on push to `main`, so no deploy job is duplicated here — one deploy
   path, one place to keep correct.
10. **Harness.** Local Node server that replays the real `/*` CSP header; two
    fixture posts; real browser at 375px and 1280px on `/`, `/blog/`, both
    posts, `/music/the-journey/`; `hallmark` audit + `frontend-design` for zero
    drift from `/`; verify the +2px type bump did not break the mobile nav, the
    `.store-buy` buttons or the url-bar line.
11. **Verify.** `node scripts/build.test.mjs` green; `release_scheduled.py` dry
    run against a fixture with a past `publish_at`; curl 200s; ffprobe the
    avatar; the subscribe form driven against a local 202 stub; Lighthouse.
12. **Docs.** `.claude/rules/architecture.md` — the blog pipeline, the avatar
    assets, the subscribe form, the notes markers, and the exact list of
    WORKSHOP placeholders Matthew must replace.
