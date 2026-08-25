# Games Stage 1 — Drop-in Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three zero-build games (2048 → tiny-platformer → floppybird) into the live games section, plus the pre-game page fixes the Stage 0 gate and owner decisions mandated.

**Architecture:** Vanilla static site (this repo), games vendored under `games/<slug>/` served verbatim by Cloudflare Pages. Each game: vendor as-is + LICENSE + `mj-mute.js` first-script + §4a CSP normalization + tile + per-slug `_headers` policy. Spec (binding): `docs/superpowers/specs/2026-08-24-games-section-design.md`. Owner decisions + gate results: `.superpowers/sdd/2026-08-24-games-stage0-gate/progress.md` (Tasks 3–4 sections).

**Tech Stack:** Static HTML/CSS/JS; Cloudflare Pages `_headers`; wrangler preview deploys; superpowers-chrome CDP verification; Lighthouse.

**Global constraints (binding, from spec + gate rulings):**
- Main-page CSP is a contract: no inline script/style, no `innerHTML` (Trusted Types), both sha256 hashes untouched. Game routes get per-slug least-privilege CSP, never `'unsafe-inline'` for scripts, no Trusted Types (spec §4a).
- Branch `games-stage1`; NEVER push to main (push = deploy; user-gated). Preview deploys via `wrangler pages deploy <builddir> --project-name=matthew-jamison-epk --branch=games-stage1` after replicating CI (prune worker/docs, `sed s/?v=dev/?v=<sha8>/` in index.html, esbuild-minify style.css+script.js) into a scratch dir — never mutate the repo tree for a deploy.
- No AI co-author attribution in commits.
- Site aesthetic lowercase; AA contrast; `llms.txt` is a verbatim mirror — update in the same commit as any page copy/section change.
- Vendor carry-in greps per game (shell ledger): volume read-then-write fade loops (shim pins volume getter to 0 — a fade loop reading volume then writing it back would stick at 0 even unmuted: verify none, or that behavior under shim is acceptable); `.autoplay =` / `setAttribute('autoplay'` (JS-created never-inserted elements bypass the shim); the game must not globally swallow Escape (parent needs it; iframe Escape is forwarded by the overlay's contentDocument listener — the game must not stopPropagation/preventDefault Escape at document level).
- Each game's iframe URL is `/games/<slug>/` (trailing slash — Task 1 pins this; edge 308s `/index.html`).
- Games render at any viewport inside the overlay (dvh); no fixed pixel heights.
- Every game folder keeps its upstream LICENSE (floppybird: Apache-2.0 — retain NOTICE if present). Record vendored upstream commit SHA in the vendor commit message.
- Deploy limits: log `git ls-files | wc -l` and largest file per game commit; hard limits 20k files / 25 MiB per file.

---

### Task 1: Pre-game page fixes (gate + owner-decision items)

**Files:**
- Modify: `script.js` (games IIFE, ~lines 728–908)
- Modify: `style.css` (global `:focus-visible` ~line 90; `a:hover`/`.btn-ghost:hover` accent rules; games-scoped rings ~line 1227+)
- Modify: `index.html` (press section stray `<br>`; `_test` tile `data-repo`)
- Modify: `_headers` (`/games/_test/*` block: add `img-src 'self'`)

All items below in ONE commit series (one commit per lettered item is fine, or one combined commit; keep diffs minimal).

- [ ] **(a) Page-wide AA lift (owner decision 1).** The games section got AA-compliant focus rings and hover colors; the rest of the page still uses `--mj-accent-bright` at 2.70:1 (global `:focus-visible`) and accent hover text at 2.68:1 (`a:hover`, `.btn-ghost:hover`). Lift the games treatment page-wide: read the games-scoped rules in `style.css` (~1227+) and apply the same color/outline tokens to the global `:focus-visible` rule and the two hover rules, then DELETE the now-redundant games-scoped overrides (one focus vocabulary). Verify with a contrast computation (WebAIM formula) in the report: focus ring vs adjacent background ≥ 3:1, hover text vs background ≥ 4.5:1. Do not change any other color token.
- [ ] **(b) Fast 404 detection (owner decision 2).** In `script.js` `mountFrame()`: before creating the iframe, preflight the game URL with `fetch(src, { method: 'GET', cache: 'no-store' })` (same-origin; main CSP `connect-src` includes `'self'`). On `!res.ok`, call the existing `showError()` immediately instead of mounting. On fetch rejection (offline), also `showError()`. On ok, proceed to mount (the fetch warms the HTML cache — acceptable). Keep `LOAD_BUDGET` timer as the stall backstop. Preserve idempotency: if `open` became null while the fetch was in flight (user closed), do nothing.
- [ ] **(c) Pin iframe URL to trailing slash (gate ruling).** `script.js:783`: `'/games/' + open.slug + '/index.html'` → `'/games/' + open.slug + '/'` (query param logic unchanged). The edge 308s `/index.html` to the slash form (query preserved, verified at gate) — pinning avoids one redirect per open. The (b) preflight uses the same pinned URL.
- [ ] **(d) `#game-error` announcement (final-review carry-in).** In `index.html`, add `role="alert"` to the `#game-error` element so its show is announced by screen readers (no focus move — the retry/close buttons are reachable by tab; alert role announces without stealing game focus on false positives).
- [ ] **(e) Stray `<br>` after press-inquiries comment (final-review carry-in).** In `index.html` press section, remove the leftover `<br>` that followed the removed "press inquiries" line (locate via the `// press` comment label context; widen Edit context — duplicate strings exist).
- [ ] **(f) `data-repo` (final-review carry-in).** The `_test` tile carries an unused `data-repo` attribute. The visible credit link lives on the tile per spec; the overlay credit is text-only. DROP `data-repo` from the tile markup (Stage 1 tiles carry the visible `game by <a href=repo>` link directly in their markup — see Task 3 tile pattern; the dataset attribute duplicates it).
- [ ] **(g) Test-page CSP favicon violation (final-review carry-in).** In `_headers`, `/games/_test/*` policy: add `img-src 'self'` so the browser's automatic `/favicon.ico` probe stops logging a CSP violation on the test route.
- [ ] **Verify locally:** fresh port (`python3 -m http.server <fresh-port>`), headful/CDP: open test tile (music off) → overlay opens fullscreen, iframe src is `/games/_test/`, no console errors; kill the local server mid-open… skip — instead verify 404 path by temporarily pointing a copy of the tile at a bogus slug via DevTools (`document.querySelector('.game-tile-btn').dataset.slug='nope'`) → error state appears immediately (< 1s), not after 10s; restore. Tab through the page: one focus-ring treatment everywhere.
- [ ] **Commit(s):** `fix: page-wide AA focus/hover lift (games treatment goes global)`, `feat: fast 404 preflight + pinned trailing-slash game urls`, `fix: stage-1 polish carry-ins (game-error alert, press br, data-repo, test-page img-src)`.

### Task 2: Copy workshop scaffold (controller-run, NOT a subagent dispatch)

The controller invokes the `content-workshop` skill to append games write-in blocks to `content-workshop.md`: games section intro (if Matthew wants one), keep-listening dialog copy (current placeholders: "// keep listening? keep your track playing and the game runs silent — or pause it and hear the game." / "→ keep my music" / "→ game audio"), tile label conventions. Matthew authors; his words apply verbatim in a later commit (with `llms.txt` in the same commit). **Blocks Stage 1 MERGES, not implementation** — Tasks 3–5 proceed with placeholder copy.

### Task 3: Vendor 2048

**Files:**
- Create: `games/2048/**` (vendored), `assets/games/2048-thumb.webp`
- Modify: `index.html` (tile), `_headers` (per-slug policy + cache), `llms.txt` (catalog mirror), `games/2048/index.html` (shim + externalization diff)

- [ ] **Story:** In order to play a quick puzzle without leaving the page, a visitor clicks the 2048 tile and plays fullscreen with swipe or arrow keys.
  - Given the games grid, When I click the 2048 tile, Then 2048 opens fullscreen and arrow keys/swipes register immediately.
  - Given 2048 open with "keep my music", Then the game emits no sound (it has none — shim still vendored) and my track continues.
  - Given private browsing (no localStorage), When I play, Then the game runs; best score just doesn't persist and no errors surface.
- [ ] **Vendor:** `git clone https://github.com/gabrielecirulli/2048` to a scratch dir; record `git rev-parse HEAD`. Copy the runtime files only (index.html, `js/`, `style/`, `meta/` icons if referenced, `LICENSE.txt`, favicon) into `games/2048/` — no `.git`, no README-only assets. MIT license file MUST land in the folder.
- [ ] **§4a normalization pass** (document every diff in the commit message):
  - Grep `index.html` for inline `<script>`: 2048 ships a Google Analytics inline block — DELETE it (never externalize third-party analytics; spec: strip external URLs). Any other inline script moves byte-for-byte to `games/2048/js/inline-bootstrap.js` (or similar) loaded with a plain `<script src>`.
  - Grep for inline `<style>` blocks → externalize to a file the same way. Inline `style=""` attributes: 2048's JS positions tiles via classes, not style attrs — verify with `grep -c 'style="' index.html` and grep the js/ dir for `.style.` (CSSOM is fine, not CSP-gated).
  - Audit greps (run + record output): `grep -rn "eval(\|new Function" js/` · `grep -rn "document.write" .` · `grep -rn "https\?://" index.html js/ style/` (external fonts/CDNs → strip or self-host; the ClearSans font is bundled) · carry-in greps: `grep -rn "\.volume" js/` · `grep -rn "autoplay" js/ index.html` · `grep -rn "Escape\|keyCode === 27\|key === 27" js/` (2048 uses arrows + R; must not touch Escape).
  - localStorage: 2048's `LocalStorageManager` has a `fakeStorage` fallback — verify it wraps access in try/catch (private-browsing scenario); if the support test itself can throw, wrap it.
- [ ] **Mute shim:** add `<script src="../mj-mute.js"></script>` as the FIRST script tag in `games/2048/index.html` (path identical to the `_test` page's usage).
- [ ] **Thumbnail:** play the game locally, screenshot the board mid-game (real gameplay, not the start screen), crop square, export `assets/games/2048-thumb.webp` at 700px (the tile renders ~130–150px; one webp with explicit `width`/`height` attrs matching the tile's rendered box — follow whatever the `_test` tile art does).
- [ ] **Tile:** copy the `_test` tile markup pattern in `index.html` exactly (same classes/structure), with: `data-slug="2048"`, `data-name="2048"`, `data-author="Gabriele Cirulli"`, visible credit `game by <a href="https://github.com/gabrielecirulli/2048" target="_blank" rel="noopener">Gabriele Cirulli</a>`, thumbnail img (`loading="lazy" decoding="async"` — below fold), `alt=""` on the img, accessible name from the visible tile name (NO aria-label — Stage 0 audit rule). Keep the `_test` tile in place (it leaves at stage end only if Matthew says so — default: keep, it's noindexed and harmless).
- [ ] **`_headers`:** add, mirroring the `_test` block's detach pattern:
  ```
  /games/2048/*
    ! X-Frame-Options
    ! Content-Security-Policy
    X-Frame-Options: SAMEORIGIN
    X-Robots-Tag: noindex
    Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'
  /games/2048/js/*
    Cache-Control: public, max-age=31536000, immutable
  /games/2048/style/*
    Cache-Control: public, max-age=31536000, immutable
  ```
  Adjust directives ONLY per the audit's evidence (e.g. add `font-src` only if the bundled font is loaded via `@font-face` — check; drop it if unused). `X-Robots-Tag: noindex` on game routes: game pages are overlay content, not landing pages.
- [ ] **`llms.txt`:** add the game to the games section mirror verbatim from the page markup (existing convention from the `_test` entry).
- [ ] **Verify locally:** fresh port; full playthrough via headful CDP: open (music off) → arrows register with zero clicks (focus check: `document.activeElement` is the iframe, inner doc receives keydown); a few moves; Escape closes; reopen with music playing → dialog → "keep my music" → play → close → track uninterrupted. Private-mode localStorage check: in DevTools, `Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})` inside the iframe BEFORE game script runs is fiddly — instead verify the code path by reading `js/local_storage_manager.js` fallback and noting it in the report. Record `git ls-files | wc -l` + largest file.
- [ ] **Commit:** `add: 2048 by gabriele cirulli (vendored @ <sha8>, csp-normalized)` — body lists every normalization diff + audit grep results.

### Task 4: Vendor tiny-platformer

Same procedure as Task 3 with these specifics:

- [ ] Repo: `https://github.com/jakesgordon/javascript-tiny-platformer` (MIT), author credit "Jake Gordon". Slug `tiny-platformer`. Files: index.html + game js + `tiles.png` + `level.json` + LICENSE.
- [ ] **Known shape:** the game code likely lives INLINE in index.html (tiny single-file repo) — the §4a externalization moves it byte-for-byte to `games/tiny-platformer/game.js`. `level.json` is fetched at runtime → CSP needs `connect-src 'self'` (verify how it loads: XHR/fetch vs embedded).
- [ ] Keyboard-only game — the focus story is the acceptance test: Given the tile clicked, When the overlay opens, Then LEFT/RIGHT/UP move the player with NO prior click on the game (`iframe.focus()` from Stage 0 fix must deliver). Verify the game listens on its own document/window for keydown and does not preventDefault Escape (carry-in grep: it handles KEY.LEFT/RIGHT/UP/DOWN codes — confirm 27 is not among them).
- [ ] Touch: game is keyboard-only (brief accepts this). Tile still opens/closes fine on touch — no dead state; note in report that mobile playability is "watch only" and flag for Matthew's device-matrix judgment.
- [ ] `_headers` policy: 2048 shape (`script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'` + detach + SAMEORIGIN + noindex + immutable cache on png/json/js assets — enumerate actual dirs).
- [ ] Thumbnail `assets/games/tiny-platformer-thumb.webp` from real gameplay.
- [ ] Commit: `add: tiny platformer by jake gordon (vendored @ <sha8>, csp-normalized)`.

### Task 5: Vendor floppybird

Same procedure as Task 3 with these specifics:

- [ ] Repo: `https://github.com/nebez/floppybird` (Apache-2.0 CODE license — LICENSE file MUST vendor; retain NOTICE if present; the sprite-art caveat is a documented decision in the brief §5, restate it in the commit body). Author credit "Nebez Briefkani". Slug `floppybird`.
- [ ] **Audio game** — this one exercises the mute shim for real: it plays media-element sounds (`js/` audio usage — audit which mechanism). Carry-in greps are LOAD-BEARING here: `grep -rn "\.volume" js/` (a read-then-write fade loop under the shim's pinned-0 getter would break audible mode too — verify none, or rule); `grep -rn "autoplay" .` (JS-created never-inserted autoplay elements bypass the shim).
- [ ] Acceptance: Given music playing and "keep my music", When the bird flaps and crashes, Then zero audible game sound and the track never stutters. Given "game audio", Then flap/score/crash sounds play as shipped.
- [ ] Touch + keyboard + click all flap — verify first tap registers (no dead state).
- [ ] §4a: index.html likely carries inline `<script>` blocks (GA + init) — strip GA, externalize init byte-for-byte. CSP: 2048 shape + `media-src 'self'` for its audio files. Immutable cache on `assets/`, `js/`, `css/`.
- [ ] Thumbnail `assets/games/floppybird-thumb.webp` from real gameplay.
- [ ] Commit: `add: floppy bird by nebez briefkani (vendored @ <sha8>, csp-normalized)`.

### Task 6: Stage gate — preview deploy + verification (controller + user)

- [ ] Preview deploy (CI-replica scratch build → `wrangler pages deploy --branch=games-stage1`).
- [ ] Per-slug header curls on the preview URL (`-sL`, browser UA): each `/games/<slug>/` final response carries its own CSP + SAMEORIGIN + noindex; `/` still strict (both hashes + trusted-types); immutable `cache-control` on one sampled asset per game.
- [ ] Headful playthrough of ALL THREE games on the preview: zero `securitypolicyviolation` events, both music-dialog paths on floppybird (the audio game), keyboard-immediacy on tiny-platformer, rapid open/close/open ×3 leak check (single overlay, no stray iframes/listeners/scroll locks).
- [ ] Lighthouse against the preview root ≥ 90 performance, no CLS from tiles (thumbnails have explicit dimensions).
- [ ] File-count + largest-file log vs 20k/25MiB.
- [ ] Hand Matthew the preview URL for the device matrix (spec §6, all five device classes, per game) + the copy workshop status. **Merge to main only after his pass + his copy lands (owner decisions 3, 4). Gate NOT claimable on his behalf.**

### Then

Stage 2 (HexGL) gets its own plan after this gate passes; Stage 3 (Sandspiel) after that — per spec §5 phasing.
