# SEO Reorientation — matthewjamison.dev (Project 1 of 2)

## Context

The EPK/store single-page site has nav wording chosen for aesthetics, not search intent, a name-only H1, and section order that buries money sections. Matthew wants keyword-researched nav/heading/meta wording (benchmarked against artist-SEO practice — Thundercat / Flying Lotus / Ski Beatz patterns), a physical section reorder, and a new Collabs section exposing his collaborator long-tail (jason chu, sila, Cryptic One, Barrel Proof, Wulf Morpheus, Pinstrype Kouzin, jacuzzi jefferson, StlnDrms/Piklo, Complete Beats, DonutxSlinger — **Maven Lee excluded**: do not mention anywhere; Matthew plans to replace "Love, Interlaced" later with `~/Downloads/MUSIC FROM SIDECHAIN DISCORD/Guitar_Bass_Drums_1.mp3`, out of scope here). A separate follow-up project (Project 2) handles the visual/word-wrap pass (footer github/substack removal, mailto contact, mobile wrapping, desktop styling decisions via /frontend-design + /hallmark) — deliberately AFTER final nav words exist.

Approach chosen: **hybrid (C)** — full single-page on-page optimization now; keyword data decides whether a future dedicated `/bass-samples/` page project is warranted (note it in findings, do not build it).

Workflow requested: Fable plans → Opus implements → Fable reviews/optimizes → iterate until top-1% quality.

## Decisions locked with Matthew

- **Section order (DOM reorder):** hero → catalog → games → samples → videos(watch) → services → contact → gear(rider) → collabs(NEW) → press → bio → process → footer.
- **Nav order:** matches scroll order (drops the alphabetical rule from commit 21a3a71 — intentional reversal).
- **Renames (pending keyword confirmation):** rider → "gear", watch → "videos"; samples label decided by research ("bass samples" vs "bass sample packs" vs "bass loops").
- **Collabs shape:** grouped by artist — one row per collaborator: name, track titles, streaming link. Placed in credibility cluster before press.
- **H1:** keep visible `matthew jamison`, extend with lowercase keyword descriptor (exact copy through Matthew's approval — first-person/humble voice rules).

## Hard constraints (from .claude/rules + memory)

- **NEVER claim "royalty-free" for bass loops** (Master Clearance Agreement — only one-shots/slides/noise/fills are royalty-free). Applies to all SEO copy, meta, keywords targeted.
- **llms.txt is frozen** — do not touch. robots.txt + sitemap.xml are the maintained surfaces.
- **CSP contract:** no inline styles/scripts, Trusted Types, JSON-LD **and** store-data JSON are sha256-pinned — any edit to either requires hash recompute in `_headers`. New external hosts need explicit CSP sources (plain `<a href>` links are NOT CSP-gated — streaming links fine).
- Site aesthetic lowercase; section labels are `<h2 class="section-label comment">` content. Copy in Matthew's voice — draft → per-element approval; substantive copy via content-workshop pattern.
- Catalog tile alt/aria rules, video caption rules, font self-hosting, starfield perf constraints — do not disturb (see architecture.md).
- Lighthouse baseline 98/100/100/100 must not regress. Headless Chrome screenshots render black — verify in real browser.
- DataForSEO auth: `op://Private/DataForSEO_API/credential` is a PRE-ENCODED Basic token — send `Authorization: Basic <credential>` directly (curl -u 401s). Never echo the value. Scripts hitting APIs need a real UA for Cloudflare-fronted hosts.

## Phase 0 — Research (Opus executes, Fable reviews)

1. **DataForSEO keyword pulls** (search_volume + related_keywords + live SERP where useful) for candidate terms:
   - samples: "bass samples", "bass sample packs", "bass loops", "bass one shots", "sp-404 samples"
   - store: "buy beats direct", "beat tapes", "instrumental albums", "buy music direct from artist"
   - services: "session bassist", "session bass online", "custom bass line", "hire bassist remote"
   - brand/collab: "STLNDRMS", "stlndrms tape", collaborator names (NO Maven Lee), "matthew jamison" variants
   - games/videos/gear/press/contact nav-label sanity checks
2. **Reference verification** (firecrawl/WebFetch): pull 2–3 reputable artist-SEO sources (e.g. Ahrefs/Backlinko/Moz musician-SEO guides) + inspect Ski Beatz sample-pack page structure, Thundercat/FlyLo site nav/meta as pattern references. Every recommendation in the findings doc must cite volume data or a named source — no vibes.
3. **Output:** `docs/superpowers/specs/2026-08-25-seo-reorientation-design.md` gains a findings appendix: keyword table (term, volume, intent, chosen label per section), proposed `<title>`, meta description, H1 descriptor options (2–3), collabs heading, and a go/no-go note on a future `/bass-samples/` standalone page.
4. **Gate:** Matthew approves final wording per element (nav labels, H1, title, meta desc, section `//` labels) before any HTML edit. Use draft-with-options format, not AskUserQuestion walls.

## Phase 1 — Implementation (Opus)

Files: `index.html`, `style.css`, `script.js`, `_headers`, `sitemap.xml`.

1. **DOM reorder** of `<section>` blocks to locked order. Then verify coupling: nav-highlight / section-spotlight logic in `script.js` (check for any order-dependent selectors or nth-child CSS in `style.css`).
2. **Nav rewrite:** labels per approved research, order = scroll order. Mobile nav density unchanged (Project 2 handles visual tightening).
3. **Headings:** update `//` section labels with approved keyword phrasing; keep lowercase + `&nbsp;·&nbsp;` conventions (source-exact edits — widen context for duplicate strings; two "perspective" tiles footgun).
4. **H1 + hero:** approved descriptor added inside/adjacent to H1 per approved copy.
5. **Collabs section (NEW):** `<section id="collabs">`, grouped-by-artist rows (name, tracks, one streaming link per artist — Matthew supplies preferred links, else Apple Music/Spotify artist-page URLs gathered in Phase 0). Reuse existing panel/row patterns from rider/press markup — no new CSS system. Plain anchors, no CSP change needed. AA contrast tokens.
6. **Meta:** rewrite `<title>` + meta description; add/verify OG/Twitter equivalents if present.
7. **JSON-LD:** extend with collaborator credits + any new Offer/keyword fields; **recompute BOTH pinned hashes** (JSON-LD + store-data block if touched) in `_headers`.
8. **sitemap.xml:** lastmod bump. robots.txt unchanged. llms.txt untouched.
9. Anchor ids: keep existing ids (`#rider`, `#watch`, `#samples`) working — if ids are renamed for SEO, add nothing that breaks inbound links; prefer keeping ids stable and changing only visible labels (decide in Phase 0 findings; default = ids stable).

## Phase 2 — Fable review loop (iterate until top 1%)

- **Style/elegance benchmark:** Fable reviews the page against skibeatz.com, theamazingthundercat.com, flying-lotus.com — NOT to copy their style, but as discipline/passion comparison markers: information hierarchy clarity, restraint, how money sections are presented, typographic care, how collabs/credits are honored. Findings feed the fix-list; site keeps its own lowercase/starfield identity.
- Serve locally, verify in REAL browser (headless renders black): desktop + iPhone-width — full scroll, nav clicks land on right sections, spotlight tracks correctly.
- Console: zero CSP/Trusted-Types violations.
- Lighthouse mobile emulation: ≥ 98/100/100/100 baseline.
- Rich results: validate JSON-LD (schema.org validator).
- WCAG 2.1 AA spot-check via wcag-security checklist (new collabs section: contrast, focus order, link names).
- Stress/edge: long collaborator names wrap on 320px; collabs section with JS disabled still readable; no layout shift from reorder.
- Copy check: no "royalty-free loops" claim anywhere; Matthew's voice preserved.
- Fable writes fix-list → Opus executes → repeat until clean. Then commit(s), push (deploy is push-to-main — confirm with Matthew before push).

## Verification (end-to-end)

1. `python3 -m http.server` (or existing local server on 8124) → real-browser pass above.
2. `npx lighthouse` mobile run vs baseline.
3. Post-deploy: curl (with UA) live HTML for new meta/title; Google Rich Results test on live URL; confirm robots/sitemap 200.

## BDD scenarios

```
Scenario: Search-intent nav labels
  Given a visitor lands from a "bass sample packs" style search
  When they read the nav
  Then a link matching their query intent is visible and scrolls to the samples section

Scenario: Section reorder preserves behavior
  Given the reordered page
  When scrolling hero through footer
  Then sections appear in the locked order and nav/spotlight effects track correctly

Scenario: Collabs section surfaces collaborators
  Given the collabs section
  When a visitor scans it
  Then each collaborator appears with tracks and a working streaming link, AA-contrast, readable at 320px

Scenario: Metadata integrity
  Given updated JSON-LD, title, and meta description
  When the page loads under the enforced CSP
  Then zero console violations and rich-result validation passes
```

## Out of scope (queued as Project 2 — visual pass)

Footer: remove github + substack rows, add direct `mailto:matthewjamisonmusicinquiries@gmail.com`; word-wrap fixes for long strings (email, "soundcloud") via `overflow-wrap:anywhere`/`<wbr>`; mobile nav visual tightening; desktop styling decisions with concrete visual examples using /frontend-design:frontend-design + /hallmark. Spec'd after this project ships.
