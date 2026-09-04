# Phase 1 — release pages `/music/<slug>/` (implementation plan)

Spec: `docs/superpowers/specs/2026-09-04-content-layer-design.md` § "Phase 1".
Branch: `content-layer`. Commit locally, no push, no merge.

## Acceptance scenarios (BDD — copied from the spec)

1. **Given** `data/releases.json` has `the-journey`, **when** the site deploys,
   **then** `https://matthewjamison.dev/music/the-journey/` returns 200, has one
   `<h1>the journey</h1>`, a 13-item tracklist, a canonical to itself, and a
   `MusicAlbum` JSON-LD that passes Google's Rich Results Test.
2. **Given** a buyer on a release page, **when** they click `→ buy`, **then**
   they land on Stripe Checkout for that slug (same Worker route as the catalog).
3. **Given** the sitemap, **when** fetched, **then** it lists `/`, `/music/`,
   and every release with a `lastmod`.
4. Lighthouse on `/` unchanged (98/100/100/100); release page ≥ 95 perf.

Outer loop = `scripts/build.test.mjs` (node:test, zero deps): runs the generator
against a temp output dir and asserts 1/3 mechanically plus the shared shell
invariants. 2 and 4 are verified by hand (browser + `npx lighthouse`).

## Steps

1. **Seed data.** `scripts/seed-releases.mjs` parses the `#store-data` JSON block
   out of `index.html` and writes `data/releases.json`
   (`slug,title,kind,price,tracks[{n,title,seconds}],released,blurb,credits`).
   Sample packs / bundle are excluded — they are not `MusicAlbum`s and live in
   `#samples`, not `#catalog`. No release-date column exists in
   `worker/migrations/*.sql` or `worker/seed-albums.live.sql`, so `released` is
   `null` for every slug and the order stays store-data order.
2. **Failing test first.** `scripts/build.test.mjs` — asserts the generator's
   output before the generator exists.
3. **Generator.** `scripts/build.mjs` — release pages, `/music/` hub,
   regenerated `sitemap.xml` (keeps `/`'s three bass-sample image entries,
   keeps `/thanks/` out).
4. **Buy button.** `release.js`, extracted verbatim from the `checkout()` path in
   `script.js` (same contract, same error copy, same `aria-busy` state).
5. **CSS.** minimum additions to `style.css` from existing tokens only.
6. **index.html.** `.store-title` becomes a link to its release page (slug from
   the card's `data-slug` — two cards are both "perspective"); one short
   lowercase link to `/music/` on the catalog `//` label line. Neither JSON block
   is touched, so neither `_headers` hash moves.
7. **Deploy.** `node scripts/build.mjs` runs *before* the sed/minify steps, so
   generated pages get the same `?v=<sha>` stamping; prune list gains
   `scripts data content` and `games/_test`.
8. **CSP check.** serve the repo locally behind the real `/*` CSP header and load
   a release page in a real browser; record whether an unhashed
   `application/ld+json` block reports a violation. Hash-pin per page only if it
   does.
9. **Docs.** `.claude/rules/architecture.md` gains a "Content layer" section.
   `.gitignore` gains `music/`. `sitemap.xml` stays committed.
10. **Harness.** `hallmark` audit + `frontend-design` pass on one release page
    against `/`; mobile word-wrap guard (wrap at `·`, no mid-word breaks).
11. **Verify.** test script, generator, curl 200s, Lighthouse on `/` and a
    release page.
