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

## Heading + targeting constraints (Matthew, Aug 25)

- H2–H4 may be used where needed, but **stylistically and minimally** — no undesired text added to the page. Minimalism is the aesthetic. Prefer keywording existing headings, meta, JSON-LD, and aria/alt surfaces before adding any new visible text.
- Precision keyword targeting on two audiences: (1) producers searching for bass samples/sample packs, (2) searches around grammy-affiliated artists.
- **Claim precision:** Matthew is grammy-AFFILIATED via collaboration (STLNDRMS). Copy must read "collaborations with grammy award-winning artists" or equivalent — never imply Matthew won a Grammy.

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

---

## Phase 0 Findings

Research run 2026-08-25 (Opus). All volumes are **Google Ads US monthly search volume** (`location_code 2840`, `language_code en`) pulled live from DataForSEO `keywords_data/google_ads/search_volume/live`; related terms from `dataforseo_labs/google/related_keywords/live`; SERPs from `serp/google/organic/live/advanced`. Raw responses are in the session scratchpad (not committed). Total API spend: **$0.3107**.

`—` means Google returned no volume row for that phrase (below the reporting floor / not enough data), which is itself a finding: nobody searches it, so it must not drive a label.

### 1. Keyword table

#### 1a. Samples cluster (primary money intent)

| term | US vol/mo | intent | recommendation |
| --- | --- | --- | --- |
| sample pack | 1,600 | commercial, generic | head term, not ownable — but the words "sample pack" must appear in title/meta |
| bass samples | **170** | commercial/free-mixed | **primary label term** — highest-volume bass-specific phrase, LOW competition, $4.54 CPC (real commercial value) |
| bass loops | 110 | commercial, HIGH comp | secondary — keep in body copy, not as the nav label |
| sp-404 samples / sp404 samples | 110 + 110 | product-specific | **strong differentiator** — already in the rider/watch labels; add to samples copy |
| free bass samples | 70 | free-seeker | do NOT target — wrong buyer |
| bass samples free (variant) | 70 | free-seeker | do NOT target |
| 808 bass samples | 70 | commercial | not our product (we sell real electric bass) — skip |
| bass sample packs | **40** | commercial | lower volume than "bass samples" — use as the *plural/long-tail* in meta, not the nav label |
| bass sample pack (sing.) | 40 | commercial, HIGH comp | same |
| electric bass samples | 30 | commercial, LOW comp | **high-fit long-tail** — describes the actual product; use in section sub-copy / JSON-LD |
| bass guitar samples | 30 | commercial | long-tail, use in JSON-LD keywords |
| bass one shots | 20 | commercial | already legitimately royalty-free per the Master Clearance Agreement — safe to name |
| bass samples hip hop | 10 | commercial, $3.41 CPC | long-tail, use in meta/JSON-LD |
| analog bass samples | 10 | commercial | long-tail, optional |
| real bass samples | 10 | commercial | long-tail, matches the honest pitch |
| sp404 sample pack | 10 | commercial, $4.45 CPC | long-tail worth a mention |
| live bass samples / live bass loops / boom bap bass loops | — | — | no data; do not build labels on these |
| bass loops for producers | — | — | no data |
| **royalty free bass loops** | 10 | commercial | **FORBIDDEN.** Volume exists but is trivial (10/mo), and the Master Clearance Agreement forbids the claim for loops. Never use. Only *one-shots / slides / noise / fills* may be described as royalty-free, and only in those exact terms. |

**Read:** the whole bass-samples cluster is roughly **550–600 searches/mo combined**, and ~40% of it is free-seeker intent. "bass samples" beats "bass sample packs" 170 to 40 — the plural product noun is *not* the higher-demand phrase.

#### 1b. Store / catalog cluster

| term | US vol/mo | intent | recommendation |
| --- | --- | --- | --- |
| instrumental albums | 480 | browse/discovery, LOW comp | **best store-section term** — use in the catalog `//` label and meta |
| beat tape / beat tapes | 210 + 210 | browse/discovery, LOW comp | strong scene-native term; pairs naturally with "instrumental albums" |
| lofi instrumentals | 170 | discovery | only if honest to the catalog; do not force |
| instrumental hip hop albums | 90 | discovery | good long-tail for JSON-LD/meta |
| buy instrumental beats | 40 | transactional | low volume; transactional wording still worth keeping on the buy buttons |
| instrumental beats album | 10 | transactional | long-tail |
| buy beats direct / buy music direct from artist | — | — | **no data.** The "buy direct" framing is an ethics/positioning statement, not a search term. Keep it as copy, do not spend a nav label on it. |

#### 1c. Services cluster

| term | US vol/mo | intent | recommendation |
| --- | --- | --- | --- |
| session bassist | **260** | mixed (see SERP note), $10.93 CPC | **highest commercial value on the whole page.** Keep "session bassist" in the H1 descriptor + title + meta |
| bass vst | 260 | product | not us — evidence the SERP is polluted |
| bass player for hire | 30 | hiring, LOW comp | good long-tail for the services `//` label |
| session musician bass / session bass online / custom bass line / hire bassist remote / online session bass recording / remote bass tracks / remote session bass / bass recording services / session bassist for hire / hire a bass player | — | — | **all no-data.** Do not build labels on remote/hire phrasings. |

**SERP note ("session bassist", top 10):** Native Instruments' *Session Bassist* plugin holds #2 and #8, so a chunk of that 260 is plugin intent. But `spikeavery.com` — a single session bassist's own site — ranks **#9** with the page title literally "Session Bassist", alongside marketplaces AirGigs (#7) and SoundBetter (#10). An individual artist page *can* rank for this term with exact-match on-page wording. That is direct evidence for the H1/title recommendation below.

#### 1d. Brand / collab cluster

| term | US vol/mo | intent | recommendation |
| --- | --- | --- | --- |
| **stlndrms** | **110** | navigational | **the single best long-tail on the page.** A Collabs row naming StlnDrms with a real outbound link is the highest-leverage new content here |
| cryptic one | 20 | navigational | worth a named row |
| jason chu music | 20 | navigational | worth a named row |
| jacuzzi jefferson | 10 | navigational | worth a named row |
| complete beats | 10 | navigational (ambiguous term) | include, low expectation |
| stlndrms tape / matthew jamison music / matthew jamison bassist / donutxslinger | — | — | no data — but **still include them**. Zero-volume collaborator names are exactly the long-tail an entity-graph/AI-answer surface uses; they cost nothing and they honor the credit. |

#### 1e. Nav-label sanity checks

| term | US vol/mo | verdict |
| --- | --- | --- |
| music producer gear | 1,000 | **"gear" is validated** — rename rider → gear confirmed by data |
| electronic press kit | 1,300 | "press" is fine as a label; "epk" is *not* a user-facing search term worth the `<title>` |
| tech rider | 880 | real demand — keep the word "rider" somewhere in the gear section copy, just not as the nav label |
| artist epk | 480 | ditto |
| artist press kit | 170 | ditto |
| press kit musician | 170 | ditto |
| musician gear list | — | no data |

**Nav conclusion on gear:** "gear" (1,000) beats "rider" (880) as the visible label, and keeping "rider" inside the section heading captures both. This is the rare case where the aesthetic rename and the data agree.

#### 1f. Grammy-affiliation angle (added mid-research at Matthew's request)

| term | US vol/mo | verdict |
| --- | --- | --- |
| grammy winning producers | 40 | tiny, and the searcher wants a *list of famous producers*, not Matthew |
| grammy award winning producer | 40 | same |
| grammy affiliated artists | — | no data |
| stlndrms grammy | — | no data |
| artists who worked with grammy winners | — | no data |
| grammy nominated producer | — | no data |
| grammy winning bassist | — | no data |
| worked with grammy winning artists | — | no data |

**Finding: the Grammy angle is not a keyword play.** There is no meaningful search demand for any phrasing of it, and the little that exists (40/mo) has celebrity-list intent that Matthew will never satisfy. Recommendation: treat it as an **E-E-A-T / trust signal**, not a ranking target —

- put it in the **JSON-LD** (`Person.knows` / `MusicGroup.member` collaborator credits, `description`), where AI answer engines and rich-result parsers read it;
- allow **one** short clause in the meta description or the collabs `//` label;
- do **not** spend the H1 descriptor or a nav label on it.

**CLAIM PRECISION (hard rule, flagged as requested).** Matthew is Grammy-**affiliated through collaboration** (STLNDRMS), not a Grammy winner or nominee. Every proposed string below that touches this uses **"collaborations with grammy award-winning artists"** or **"credits alongside grammy-winning artists"**. Any phrasing that could parse as Matthew holding or being nominated for a Grammy — "grammy producer", "grammy-winning bassist", "grammy artist", or bare "grammy" adjacent to his name — is **forbidden** and must be caught in Phase 2 review. It is both a truth problem and a schema.org `award` field that would be false. Two further notes:
- I did **not** independently verify the STLNDRMS Grammy credit in this phase. Before it ships in copy or JSON-LD it needs one citable source (Recording Academy credit, official liner notes, or a press piece). Marked **verify before publish**.
- If it can't be sourced, drop the clause entirely rather than soften it.

### 2. Recommended labels — nav + section headings

**Governing constraint (per Matthew, folded in mid-research):** *heading budget is minimal.* H2–H4 are permitted but no new text walls. Keyword weight goes, in priority order, into (1) `<title>`, (2) meta description, (3) JSON-LD, (4) the existing `<h2 class="section-label comment">` strings, (5) the `aria-label`s the sections already carry. **No new visible paragraph copy is recommended anywhere below.** Every change is a rewrite of a string that already exists.

Nav order = scroll order (locked in the spec). Anchor ids stay **unchanged** (`#catalog #games #samples #watch #services #contact #rider #press #bio`) — `#rider` and `#watch` keep working even though their labels change. Only the new `#collabs` id is added. Rationale: inbound links and any shared deep-links keep resolving, and Google gets the label from the anchor text, not the fragment.

| # | section | current nav label | recommended nav label | recommended `//` section label | justification |
| --- | --- | --- | --- | --- | --- |
| 1 | catalog | Catalog | **Albums** | `// instrumental albums &nbsp;·&nbsp; beat tapes &nbsp;·&nbsp; 29 releases &nbsp;·&nbsp; preview before you buy` | "Catalog" has no search demand. "instrumental albums" 480/mo LOW comp, "beat tapes" 210/mo LOW comp. Anchor text is a ranking signal for the fragment target — Moz/Ahrefs on descriptive anchor text. |
| 2 | games | Games | **Games** (unchanged) | unchanged | no commercial search intent; label is honest and short. Nothing to gain. |
| 3 | samples | Bass samples | **Bass samples** (unchanged) | `// bass samples &nbsp;·&nbsp; electric bass loops, fills + one shots &nbsp;·&nbsp; sp-404` | **Data confirms the current label.** "bass samples" 170/mo beats "bass sample packs" 40/mo and "bass loops" 110/mo (HIGH comp). Sub-terms fold in "electric bass samples" (30), "bass one shots" (20), "sp404 samples" (110). **Note: "loops" appears with no royalty-free claim anywhere near it.** |
| 4 | watch | Videos | **Videos** (unchanged) | unchanged (`// watch · sp-404 a · mtd bass`) | spec-locked; "sp-404" in the heading already earns the 110/mo sp404 cluster. |
| 5 | services | Services | **Session bass** | `// session bass &nbsp;·&nbsp; bass player for hire &nbsp;·&nbsp; consulting` | Highest commercial value on the page: "session bassist" 260/mo, **$10.93 CPC**, and SERP #9 is an individual bassist's own site titled "Session Bassist" (spikeavery.com). "Services" is a zero-intent word. "bass player for hire" 30/mo LOW comp. |
| 6 | contact | Contact | **Contact** (unchanged) | unchanged | navigational; users expect the word. No keyword gain available. |
| 7 | rider | Gear | **Gear** (unchanged) | `// gear + rider &nbsp;·&nbsp; sp-404 a` (unchanged) | "music producer gear" 1,000/mo; "tech rider" 880/mo. Current heading already carries both words. **Rename confirmed by data; keep `#rider` as the id.** |
| 8 | collabs (NEW) | — | **Collabs** | see §5 | "stlndrms" 110/mo is the strongest long-tail available; "cryptic one" 20, "jason chu music" 20, "jacuzzi jefferson" 10. |
| 9 | press | Press | **Press** (unchanged) | unchanged | "artist press kit" 170, "press kit musician" 170 — the section already *is* the EPK; the label is right and short. |
| 10 | bio | Bio | **Bio** (unchanged) | unchanged | navigational. |

**Two labels I recommend *against* changing despite volume:** "Press" → "Press kit" (170/mo) and "Bio" → "About". Both add characters to an already-dense mobile nav for sub-200/mo terms whose intent is people looking for *EPK templates*, not for Matthew. Not worth the density cost. Documenting the rejection so it isn't re-litigated.

### 3. `<title>` and meta description

Current: `<title>matthew jamison · epk</title>` — 22 characters, of which "epk" targets template-seekers. It leaves roughly 38 characters of the SERP line unused and names neither the instrument nor the product.

**`<title>` options** (target ≤ 60 chars so Google doesn't truncate):

- **Option A — 48 chars:** `matthew jamison · session bassist · bass samples`
  Leads with the brand entity, then the two highest-value terms ($10.93 and $4.54 CPC). Cleanest read, most room to spare.
- **Option B — 58 chars:** `matthew jamison · bass samples + st. louis session bassist`
  Puts the product first (front-loads the commercial term), adds the geo qualifier that already lives in the hero tags. Slightly tighter to the limit.

Recommendation: **A**. Front-loading the name is correct for a personal-brand entity page (see the benchmark table in §6 — all three reference sites lead with the artist name), and A leaves headroom if a word is added later.

**Meta description options** (target ≤ 155 chars). The current one is ~205 chars and gets cut mid-phrase.

- **Option A — 138 chars, no Grammy claim:**
  `st. louis session bassist + producer. bass samples, loops, fills and one shots, plus 29 instrumental albums. preview everything, buy direct.`
- **Option B — 152 chars, with the affiliation clause:**
  `st. louis session bassist + producer. bass samples, sp-404 beat tapes, 29 instrumental albums, buy direct. collaborations with grammy award-winning artists.`

Recommendation: **B if and only if the STLNDRMS Grammy credit is sourced** (see §1f). Otherwise **A**. Both are lowercase-aesthetic, first-person-adjacent, and neither contains "royalty-free".

`og:title` / `og:description` should be brought in line at the same time — `og:title` currently reads `matthew jamison · epk` and would otherwise contradict the new `<title>` in social/AI previews.

### 4. H1 descriptor options

The visible H1 stays `Matthew Jamison`; the descriptor is a lowercase keyword line appended inside or immediately adjacent to it. Benchmark practice (§6) is that artist sites put the bare name in the H1 and nothing else — which is fine when the artist has Wikipedia-scale brand demand. Matthew does not ("matthew jamison bassist" returns no volume), so the descriptor is doing work those sites don't need theirs to do. This is a deliberate divergence from the benchmarks, not an oversight.

- **Option 1:** `session bassist · producer · bass samples`
  The two paid-intent terms plus the role. 41 chars, scans as a credit line.
- **Option 2:** `st. louis session bassist · bass samples · sp-404`
  Adds geo and the gear differentiator (110/mo sp404 cluster). Slight overlap with the existing `.tags` line beneath the H1.
- **Option 3:** `bassist · producer · instrumental albums + bass samples`
  Widest coverage — pulls in the 480/mo "instrumental albums" term. Longest; most likely to wrap at 320px.

Recommendation: **Option 1**, with the catalog term carried by the `//` label in §2 instead. It is the shortest, has zero duplication against the `.tags` line already under the H1, and it is a phrase Matthew would plausibly say about himself.

If Option 2 is chosen, the `.tags` line should drop "St. Louis, MO" to avoid stating the geo twice within 40px.

### 5. Collabs section heading options

Both in the existing `<h2 class="section-label comment">` `//` style, both lowercase, both source-exact on the `&nbsp;·&nbsp;` separator convention:

- **Option 1 (name-forward):** `// collabs &nbsp;·&nbsp; stlndrms &nbsp;·&nbsp; cryptic one &nbsp;·&nbsp; jason chu`
  Puts the 110/mo term and two 20/mo terms directly into a heading element. Maximum keyword yield, zero new prose.
- **Option 2 (credibility-forward):** `// collabs &nbsp;·&nbsp; credits alongside grammy award-winning artists`
  Carries the affiliation as a trust signal. **Only usable once the credit is sourced**, and the phrasing above is the approved form — it says *alongside*, not *by*.

Recommendation: **Option 1.** The names are the actual searchable asset (§1d); the Grammy clause has no search demand (§1f) and belongs in the meta description and JSON-LD, where it reaches AI answer engines without spending a heading on a claim that needs a footnote. Option 1 also needs no verification gate, so it can't block Phase 1.

The collaborator names themselves will appear as row headings — recommend `<h3>` per artist row, which is the minimum viable structure and matches the existing rider `<h3>` pattern (no new heading *system*, no added prose). Track titles stay plain text; one anchor per artist.

### 6. Benchmark notes

| | **skibeatz.com** | **theamazingthundercat.com** | **flying-lotus.com** |
| --- | --- | --- | --- |
| `<title>` | `Ski Beatz` | `Thundercat Official Website` | `FLYING LOTUS - The Official Flying Lotus Website` |
| meta description | **empty** (`content=""`) | static: `New Album 'Distracted' Out Now on Brainfeeder. Featuring musical collaborations with Mac Miller, Willow Smith, Tame Impala, A$AP ROCKY, and Channel Tres.` — but JS injects a second tag reading just `Thundercat`, which wins in the rendered DOM | `The Official Flying Lotus Website` (identical to the title) |
| H1 | two: `SKI BEATZ` (hero) and `BOOKINGS` | one `<h1 class="title">` containing the word `Home` repeated ~147× as a marquee effect | **none** — the logo is an `<img alt="FLYING LOTUS">` |
| nav labels | `NEW ALBUM`, `NEW VIDEO`, `SKI BEATZ`, `MUSIC`, `VIDEOS`, `CONTACT` | `Tour`, `Videos`, `Menu`, `Music`, `About` | `Music`, `Film & Soundtrack`, `Store`, `Merch`, `Tour Dates`, `Follow` |
| structure | single page (Mobirise), anchors to `index.html#...` | multi-page Vue SPA (`/about`, `/tour`, `/videos`, `/music`) | multi-page WordPress; ~35 flat release slugs (`/cosmogramma`, `/flamagra`) + `/category/albums` |

**These are comparison markers, not models.** Read honestly, all three are *worse* on-page than matthewjamison.dev already is:

- **skibeatz.com serves `<meta name="robots" content="noindex">`.** It is deliberately excluded from search. Combined with the empty description and a two-word title, it is a counter-example, not a reference.
- **flying-lotus.com has no H1 at all** and its description is a carbon copy of its title. It gets one thing right — `robots: index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1`.
- **Thundercat's runtime-injected description overwrites the good static one**, so a JS-rendering crawler sees the word "Thundercat" and nothing else. Its H1 is 147 repetitions of "Home" — Google's title-link doc names "Home" as exactly the vague descriptor to avoid (https://developers.google.com/search/docs/appearance/title-link).

The reason they get away with it: all three have brand-name search demand large enough that on-page wording is irrelevant. Matthew does not ("matthew jamison bassist" returns no volume at all). **He has to earn what they inherit** — which is the entire argument for the H1 descriptor in §4 and the title in §3, and it is why "match the benchmarks" would be the wrong instruction here.

#### How Ski Beatz actually presents sample packs

Premise correction, and it matters: **skibeatz.com sells no sample packs and has no store.** The packs live on a completely separate Shopify domain — **smackpackchallenges.com ("Skibeatz Dojo")** — with no link between the two sites in either direction. That split is itself the lesson: the artist site and the sample business share no authority, no internal links, and no shared entity signal.

1. **The taxonomy is brand-name-first, not keyword-first — and it costs him.** Collections are `/collections/sample-overload`, `/collections/smoke-packs`, `/collections/the-dojo-kontakt-series`, `/collections/mpc-gang`. Products are `/products/smack-pack-vol-19`, `/products/moog-mentum`. No generic head term ("hip hop drum kit", "MPC expansion", "SP1200 samples") appears in a single URL. Nobody searches "smack pack" cold. **This is the exact failure mode our "Catalog"/"Services" labels have**, and the reason §2 replaces them.
2. **Titles and nav are content-free.** Homepage title and meta description are both literally `Skibeatz Dojo`; the catalog page is `Products – Skibeatz Dojo`; product titles are raw Shopify defaults with no format, genre, or even the words "sample pack". Main nav is two items: `Home`, `Catalog`.
3. **Keywords live only in product body copy, and it reads templated.** Vol 19: *"a sound pack created by renowned producer Ski Beatz… punchy kicks, snappy snares, crisp hi-hats… Whether you're producing hip-hop, trap, R&B, or any other genre…"* — Vols 18/19/20 share that closing sentence near-verbatim. The packs with actual voice are the short ones: Vol 6 is *"A bunch of sounds lol!! Enjoy."*; Sample Overload is *"This is what happens when you overdrive you drums sounds through a Sp1200!! Enjoy!!"*. **Matthew's voice rules already put him on the right side of this** — the honest one-liner outperforms the keyword-stuffed paragraph, and Google's snippet doc agrees that long keyword strings *"are less likely to be displayed as a snippet"* (https://developers.google.com/search/docs/appearance/snippet).
4. **The one pattern worth stealing: contents as a hard spec sheet.** Vol 7 — *"50 Bizkel Breaks. 20 Extra Snares. 20 Fracture Claps."* Vol 8 — *"30 Bizkel Breaks. 26 Hihat Loops. 25 Percs. 10 Texture Loops."* Countable, scannable, differentiates near-identical products, and it is exactly the concrete-facts pattern Google's own snippet examples use. **Recommendation: give each bass pack a counted contents line** (e.g. `40 loops · 25 one shots · 12 fills`). It is one short string per card, costs no new prose, and satisfies the minimal-heading constraint.
5. **Price presentation is broken Shopify default** — every card renders `Regular price$25.00 / Sale price$25.00 / Regular price~~~~ / Unit price/per / SaleSold out`, with dead "Sale" and "Sold out" labels on products that are neither. Our `kind · $price` line is cleaner than the benchmark. Price ladder for reference: $25 standard packs · $30–40 specialty · $88 bundle · $150 masterclass · $0 free lead magnet. Note also that his **best-ranking pack pages are on other people's domains** (Roland's `Smack by Ski Beatz`, Akai/MPC Store's `Dojo Dust Instruments`) — an argument for keeping our packs on our own domain, which we already do.

### 6b. Reference guidance applied

Every recommendation above traces to one of these:

- **Titles must be descriptive, and there is no character limit** — Google truncates the *displayed* link to device width; Ahrefs' practical rule is under ~70 chars. Google names "Home"/"Profile" as the vague descriptors to avoid, and calls out music-specific boilerplate by name: *"a common `<title>` element for all pages with text like 'Band Name - See videos, lyrics, posters, albums, reviews and concerts' contains a lot of uninformative text."* (https://developers.google.com/search/docs/appearance/title-link) → drives §3.
- **Meta description = a pitch, and concrete facts beat prose.** Google's worked product example is a bare fact string: `Written by A.N. Author, Illustrated by V. Gogh, Price: $17.99, Length: 784 pages`. (https://developers.google.com/search/docs/appearance/snippet) → drives §3 and the counted-contents recommendation.
- **One H1, matched to the title, front-loaded with the target term.** Mueller via Ahrefs: *"a heading is a really strong signal telling us this part of the page is about this topic."* Ahrefs also cites 2024 Gotch SEO data showing a negligible −0.03 correlation for *partial* keyword match, so natural phrasing and synonyms are fine — the descriptor doesn't need to be a stiff keyword string. WebAIM's screen-reader survey found **60% of screen-reader users prefer only the page title be an H1**, which is why §4 keeps the descriptor inside/adjacent to the single existing H1 rather than adding a second one. (https://ahrefs.com/blog/h1-tag/, https://webaim.org/projects/screenreadersurvey7/#heading) → drives §4.
- **Single-page sites: optimize each section against its own keyword, and put the keyword in the anchor link.** *"Putting a targeted keyword in each anchor link simplifies both your site's navigability and crawlability."* (https://seranking.com/blog/single-page/) → this is the core justification for §2: on a one-pager the nav anchor text *is* the internal-linking signal, so "Catalog" and "Services" are wasted anchors.
- **Google can render section anchors as "Read more" deep links inside the snippet** — but only if the content is *"immediately visible on the page to a human (and not hidden behind an expandable section or tabbed interface)"* and JS doesn't force scroll position or strip the fragment. (https://developers.google.com/search/docs/appearance/snippet) → **two live consequences for this repo:** (a) the catalog's 12-shown-plus-expand pattern means the 17 hidden tiles are ineligible for deep links, and (b) the bio's short/medium/long **tab** interface is hidden content by this definition. Neither is worth breaking for the benefit, but both should be recorded as known ceilings rather than rediscovered in Phase 2.
- **Anchor ids: the SE Ranking guide argues ids should carry the keyword** (`#about-company-name`). That pulls against the spec's default of keeping ids stable. **Recommendation: keep the ids stable anyway** — `#rider` and `#watch` stay. The deep-link benefit is driven by visible content and anchor text, not by the fragment string, and renaming ids breaks any inbound or shared deep-link for a benefit no source quantifies. Logged as a considered-and-rejected trade, not an oversight.
- **Schema.org: use `MusicGroup` — it "also applies to solo artists"** — placed on the homepage or sitewide; fill `sameAs` with every official profile; put `MusicAlbum` on your own releases because *"Google considers your official band website to be the most authoritative source of information about your music."* (https://bandzoogle.com/blog/how-to-optimize-your-band-schema) → **this is where the collaborator names and the Grammy affiliation should land.** The collabs rows give us real `sameAs`-adjacent outbound links and collaborator entities; the affiliation belongs in `description`, never in an `award` field (§1f). Validate at https://validator.schema.org/. Reminder from `architecture.md`: the JSON-LD block is sha256-pinned in `_headers` — any edit requires a hash recompute.

**Sources note:** `https://ahrefs.com/blog/seo-for-musicians/` does not exist (404), and Backlinko, Moz, and SEJ have no musician-specific on-page guide. Google Search Central was substituted for the canonical title/meta/H1 rules and Bandzoogle for the music-vertical schema guidance. No recommendation in this appendix rests on an unnamed source.

### 7. Collaborator streaming links

Maven Lee is excluded by instruction and appears nowhere in this research. Where an artist could not be confidently identified, the row says **link TBD** rather than guessing — a wrong link in a credits section is worse than no link.

| artist | streaming link | confidence | evidence |
| --- | --- | --- | --- |
| jason chu | https://open.spotify.com/artist/4iYrlt4ga3CGYF7Z2mUDxV | **high** | Spotify bio: LA-based rapper/activist, "prominent voice in the national Asian American scene". Apple Music credits list **Matthew Jamison as songwriter** on "Animal Crossing" and "Vibranium"; grandmaster.bandcamp.com's "Vibranium" credits read *"Produced by Braden 'DJBrado03' Palafox & Matthew Jamison."* |
| sila | **link TBD — confirm with Matthew** | — | Only trace is a credit line on Matthew's own Bandcamp track (Noh)_Talent: *"Lasers By - Sila"*. No handle, no link, and the name collides with hundreds of unrelated results. Not confirmable from public sources. |
| Cryptic One | https://open.spotify.com/artist/1we4hPy7TbMM543Fyksn26 | **high** | Spotify bio links the Bandcamp Daily Atoms Family feature; discography includes the "Crypstramentals" volumes on Centrifugal Phorce Records. Appears as Bandcamp supporter "crypticone" on (Noh)_Talent. |
| Barrel Proof | **link TBD — confirm with Matthew** | — | Right person located (Instagram @barrelproofbeats; released "Barrel Proof Breaks" as a BandLab Sounds exclusive; Bandcamp fan account `bandcamp.com/barrelproof`, seen supporting releases in Matthew's orbit including "Hajime") but he has **no DSP artist page** — he distributes via BandLab and Instagram. **`barrelproof.bandcamp.com` is a different artist (a Montreal rock band) — do not use it.** |
| Wulf Morpheus | https://open.spotify.com/artist/5gEusGj9n6oXOEJXcA7IfN | **medium-high** | 5.8K monthly listeners; Fayetteville, NC producer. Discography ("sisyphal stance", "The Misadventure Of Lym David, Vol. 1") matches his X handle @WulfMorpheus; credited in the site's own store data (bojji's resolve tracks 2–3); only one artist by this name exists. Downgraded from high because a second verification pass could not tie the Spotify discography to those specific collaborations — **worth one confirming glance from Matthew**, though the name uniqueness makes a wrong match unlikely. |
| Pinstrype Kouzin | https://open.spotify.com/artist/1xBZIWe1r06a43hWM1mHg1 | **high** | East Cleveland beatmaker. Decisive: Shazam's artist page for this exact Apple ID is titled **"matthew-jamison-and-pinstrype-kouzin"**. Credited on ryokō, bojji's resolve, Jeremiah 29:11. |
| jacuzzi jefferson | https://open.spotify.com/artist/2OxHUuZT8RnLcPEqiQDUFw | **high** | 27K monthly listeners; Brooklyn producer, works with Pool Cosby. Consistent identity across Chillhop, Stereofox, Musicbed, Genius. Only one artist under the name. |
| StlnDrms | https://open.spotify.com/artist/5RnfkEaxr2jcRL4aUaTWKI | **high** | Atlanta beat-scene producer / sample-library curator (Ableton feature, Controllerise co-founder). Heavily credited across "the journey" and ryokō, and on Complete Beats' "Komorebi" (*"Drums: Stlndrms on 4Stories"*). Independently confirmed twice in this research. |
| Complete Beats | https://open.spotify.com/artist/3TDbdzMhUVGCYlmNipGsHz | **high** | Taken from the artist's **own** link-in-bio (solo.to/complete_beats). Ohio boom-bap producer; "Komorebi" (2025) credits *"Bass: Matthew Jamison on 'Tamim (A Complete Introlude)' and 'Lookin' Up'."* |
| **R.A.D.I.C.** (as MATT x R.A.D.I.C.) | **link TBD — confirm with Matthew** | — | **Collaborator not in the original brief's list — surfaced during research.** The duo album "Hajime" is Bandcamp-only: https://mattxradic.bandcamp.com/album/hajime-2, duo bio *"the artist R.A.D.I.C. & the artist Matthew Jamison — @Radicbynature @matthewjamisonmusic"*. Instagram: https://www.instagram.com/radicbynature/. No DSP page confirmable — the name collides with Radic The Myth, Sam Radic, and others. **Ask Matthew whether R.A.D.I.C. should get a collabs row at all** (a full duo project arguably outranks several rows above it). |
| DonutxSlinger | https://music.apple.com/us/artist/donutxslinger/1473218550 | **medium** | Germaine Davis, Buffalo NY beat-smith; his IG release post lists *"FEATURING: DEWATITDO GOLEK BRLNZ **MATTHEW JAMISON** OG YASUKE RIJO BEATS."* **Apple Music recommended over Spotify here** — there are two Spotify profiles (`0dE8sDmT1HziJw1aMZ3v6A`, which carries the real bio, and `3Id3fY5xNYKv6p9iOWF8bc`), so ask Matthew which he considers current before using a Spotify URL. |

**Official sites available as secondary or preferred links** — Matthew may prefer these over DSPs for some rows, since an outbound link to an artist's own domain is a stronger entity signal than a DSP profile:

- StlnDrms — https://stlndrms.com
- **YouTube links — DO NOT USE WITHOUT VERIFICATION.** The research subagent surfaced two different videos on the STLNDRMS channel said to feature Matthew and R.A.D.I.C., and reported each as if Matthew had supplied it:
  - https://www.youtube.com/live/7ajkMPh89fc — described as a live jam session, labelled "user-provided"
  - https://www.youtube.com/live/KkgwLSy_N8w — described as *"How to meditate" w/ Matthew Jamison and R.A.D.I.C.*, labelled "user's second addition"

  **Matthew supplied neither.** No link of any kind reached this research phase from him; both came from the agent's own searching, and it gave two different URLs on two passes of the same task. Treat both as unverified leads: open them, confirm what they actually are, and confirm with Matthew before either appears on the site. Flagging the pattern because a fabricated "the user asked for this" is exactly the kind of thing that otherwise slides into a spec unchallenged.
- R.A.D.I.C. — https://mattxradic.bandcamp.com/album/hajime-2 (the MATT x R.A.D.I.C. duo album) · https://www.instagram.com/radicbynature/
- Pinstrype Kouzin — https://pinstrypekouzin.com · https://pinstrypekouzin.bandcamp.com · Apple: https://music.apple.com/us/artist/pinstrype-kouzin/1447894337
- Complete Beats — https://completebeats.bandcamp.com · Apple: https://music.apple.com/us/artist/complete-beats/1399113631
- DonutxSlinger — https://www.donutxslinger.com · https://donutxslinger.bandcamp.com
- jason chu — https://www.jasonchumusic.com
- Cryptic One — https://cprec.bandcamp.com (Centrifugal Phorce Records)
- Barrel Proof — https://www.instagram.com/barrelproofbeats/ (only confirmed presence)

**Implementation notes for Phase 1:**
- 8 of 11 rows have a confident link. The three TBDs (sila, Barrel Proof, R.A.D.I.C.) should still get **rows with names and tracks** — the credit is the point, and the name is the long-tail asset (§1d). Render them as plain text with no anchor rather than blocking the section.
- All links are plain `<a href>` — **no CSP change needed** (`connect-src`/`img-src` are untouched; anchors are not gated).
- Use `rel="noopener"` and `target="_blank"` to match the existing external-link pattern in the games section.
- These URLs are also the `sameAs`-adjacent material for the JSON-LD collaborator credits (§6b).
- **No Grammy credit surfaced for STLNDRMS anywhere in this research.** The affiliation claim in §1f remains **unsourced and must not ship** until Matthew supplies a citation.

### 8. Go / no-go — future standalone `/bass-samples/` page

**Verdict: NO-GO for now. Defer, with a named re-open trigger.**

The threshold set in the brief was: build it if the "bass sample packs" + related cluster clears ~1k searches/mo **and** the SERP shows dedicated product pages ranking.

- **SERP test: PASSES.** Live top-10 for "bass sample packs" is almost entirely dedicated pages — `hiphopdrumsamples.com/products/shroom-all-killer-soul-bass-sample-pack` (#7), `oversampled.us/products/ufbt` (#8), `cymatics.fm/products/future-bass-starter-pack` (#11), plus `splice.com/sounds/instruments/bass/packs` (#10) as a category page and `shadowsamples.com` (#1) as a whole domain built on the niche. Google clearly wants a product page here, not a section of a personal site. A `/bass-samples/` page would be the correct *page type*.
- **Volume test: FAILS.** The full cluster is ~550–600/mo combined (bass samples 170, bass loops 110, sp404 samples 110, free bass samples 70, bass sample pack(s) 80, electric bass samples 30, bass guitar samples 30, bass one shots 20, plus a tail of 10s). That is roughly half the ~1k threshold, and about 40% of it — "free bass samples", "bass samples free", "bass loops free download", "bass sample pack free download" — is free-seeker intent that will never convert on a paid pack. Realistic addressable demand is closer to **250–350/mo**, split across a SERP owned by domains whose entire business is sample packs.

There is also a structural cost the volume doesn't justify: a separate page means a second URL in the sitemap, a second set of meta, product schema maintained in two places, and a fork of the store-data JSON block that is **sha256-pinned in `_headers`** — every pack edit would touch two hash-pinned surfaces instead of one.

**Re-open the decision if any of these become true:**
1. Search Console shows the `#samples` section pulling real impressions on bass-sample queries after this on-page pass lands (i.e. the intent is reachable at all).
2. The pack count grows past ~4–5, at which point a section stops being able to present them and the page earns its own information architecture.
3. Matthew starts releasing packs on a cadence — a `/bass-samples/` index over per-pack children only pays off with something to index.

Until then, §2's samples label plus the title/meta in §3 capture the same intent at zero structural cost, which is the right trade at this volume.


### 9. Sources

**Keyword / SERP data (DataForSEO, live, US / en, 2026-08-25).** Total spend **$0.3107**.

| endpoint | calls | cost |
| --- | --- | --- |
| `keywords_data/google_ads/search_volume/live` | 3 (34 + 20 + 10 keywords) | $0.27 |
| `dataforseo_labs/google/related_keywords/live` | 3 (bass samples, bass loops, session bassist) | $0.0388 |
| `serp/google/organic/live/advanced` | 2 (bass sample packs, session bassist) | $0.004 |

- https://docs.dataforseo.com/v3/ — endpoint reference. **Gotcha recorded for next time:** `dataforseo_labs/.../related_keywords/live` accepts **one task per POST** ("You can set only one task at a time"); `keywords_data/google_ads/search_volume/live` batches fine.

**On-page / SEO guidance**
- https://developers.google.com/search/docs/appearance/title-link — title requirements, the "Home"/"Profile" anti-pattern, the band-boilerplate example, no character limit
- https://developers.google.com/search/docs/appearance/snippet — meta description as a pitch, concrete-facts examples, keyword-string anti-pattern, "Read more" section deep-link conditions
- https://ahrefs.com/blog/h1-tag/ — one H1, match to title, front-load the term, Mueller quote, Gotch SEO −0.03 partial-match correlation
- https://webaim.org/projects/screenreadersurvey7/#heading — 60% of screen-reader users prefer only the page title as H1
- https://seranking.com/blog/single-page/ — single-page SEO: per-section keyword targeting, keyword-bearing anchor links and section ids
- https://bandzoogle.com/blog/how-to-optimize-your-band-schema — `MusicGroup` applies to solo artists, `sameAs`, `MusicAlbum` on your own domain, `Event` for tour dates
- https://schema.org/MusicGroup · https://schema.org/Person · https://validator.schema.org/

**Benchmark sites**
- https://skibeatz.com/ · https://theamazingthundercat.com/ · https://flying-lotus.com/
- https://smackpackchallenges.com/ · https://smackpackchallenges.com/collections/all · https://smackpackchallenges.com/products/smack-pack-vol-19
- https://www.thempcstore.com/expansions/dojo-dust-instruments-vol-1/ · https://www.roland.com/global/products/rc_smack_by_ski_beatz/ · https://bedroomproducersblog.com/2021/06/23/smack-pack-mini/

**Collaborator identification**
- Spotify artist pages: `/artist/4iYrlt4ga3CGYF7Z2mUDxV` (jason chu) · `/artist/1we4hPy7TbMM543Fyksn26` (Cryptic One) · `/artist/5gEusGj9n6oXOEJXcA7IfN` (Wulf Morpheus) · `/artist/1xBZIWe1r06a43hWM1mHg1` (Pinstrype Kouzin) · `/artist/2OxHUuZT8RnLcPEqiQDUFw` (jacuzzi jefferson) · `/artist/5RnfkEaxr2jcRL4aUaTWKI` (StlnDrms) · `/artist/3TDbdzMhUVGCYlmNipGsHz` (Complete Beats) · `/artist/0dE8sDmT1HziJw1aMZ3v6A` (DonutxSlinger)
- Apple Music: `/artist/pinstrype-kouzin/1447894337` · `/artist/donutxslinger/1473218550` · `/artist/complete-beats/1399113631` · `/artist/stlndrms/1191371290`
- Bandcamp: completebeats.bandcamp.com/album/komorebi · matthewjjamison.bandcamp.com/track/noh-talent · grandmaster.bandcamp.com/album/vibranium · mossyprojects.bandcamp.com/album/vol-1-side-a · pinstrypekouzin.bandcamp.com · donutxslinger.bandcamp.com · cprec.bandcamp.com · barrelproof.bandcamp.com (**ruled out — different artist**)
- R.A.D.I.C. / MATT x R.A.D.I.C.: mattxradic.bandcamp.com/album/hajime-2 · instagram.com/radicbynature · youtube.com/live/7ajkMPh89fc and youtube.com/live/KkgwLSy_N8w (**both unverified — see the provenance warning in §7**)
- Other: solo.to/complete_beats · donutxslinger.com · jasonchumusic.com · stlndrms.com · pinstrypekouzin.com · shazam.com/artist/matthew-jamison-and-pinstrype-kouzin/1447894337 · instagram.com/barrelproofbeats · instagram.com/donutxslinger · ableton.com/blog/make-10000-beats-story-stlndrms

**Dead end recorded:** `https://ahrefs.com/blog/seo-for-musicians/` returns 404 — no such article exists. Backlinko, Moz, and Search Engine Journal have no musician-specific on-page guide; Google Search Central and Bandzoogle were substituted. Don't re-chase this.

### 10. Open items blocking Phase 1

1. **Matthew's per-element approval** on: nav labels (§2), `<title>` (§3), meta description (§3), H1 descriptor (§4), collabs heading (§5), and the two changed `//` section labels (catalog, services).
2. **The STLNDRMS Grammy credit needs a citation** before any affiliation clause ships in copy or JSON-LD. Unsourced as of this research. If it can't be sourced, use meta description Option A and collabs heading Option 1 and drop the angle entirely.
3. **Three collaborator links (sila, Barrel Proof, R.A.D.I.C.) need Matthew's input**, and DonutxSlinger needs a Spotify-vs-Apple call. Separately: **does R.A.D.I.C. belong in the collabs list at all?** The brief didn't name them, but "Hajime" is a full duo album — if it belongs, the row may deserve more prominence than several that were in the brief.
4. **Track titles per collaborator** — the collabs rows need Matthew's list; this research established identity and links, not the per-artist track credits.
