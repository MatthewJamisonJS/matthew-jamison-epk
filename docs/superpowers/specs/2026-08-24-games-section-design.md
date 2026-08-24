# /games Section + Keep-Listening Music — Design Spec

## Context

Add a games section to matthewjamison.dev (this repo — vanilla HTML/CSS/JS EPK + store, strict CSP, Cloudflare Pages via wrangler). Source brief: `/Users/wwjd_._/Code/CLAUDE/GAMES_SECTION_BRIEF.md` (written for Hugo — adapted here to vanilla; all iframe/fullscreen/license/device-matrix guidance carries over). Five vendored open-source games, click-to-play fullscreen overlay, neal.fun-style deferred loading. New requirement beyond brief: when the visitor is listening to a catalog track and opens a game, a modal asks "keep listening?" — yes = catalog track continues and the game is fully muted; no = catalog pauses, game audio plays as intended.

User decisions (locked during brainstorm):
- Target: **this repo**, games as a **section on index.html** (single document = music survives; separate page would kill playback on navigation).
- Game audio under keep-listening: **fully muted** (music + SFX).
- Scope: **all 5 games, phased** — shell → 2048 / tiny-platformer / floppybird → HexGL → Sandspiel (defer Sandspiel if wasm build fights back).
- Modal: **ask on every game open** (no persistence, no in-overlay toggle).
- Mute mechanism: **vendored mute shim** (`mj-mute.js` first script in each game's index.html, activated by `?mjmute=1`).
- Games CSP: **per-slug least-privilege CSP** via `_headers`, no `'unsafe-inline'` for scripts — inline scripts externalized at vendor time (see §4a); main-page policy untouched.
- Execution workflow: Fable plans/reviews, Opus executes — plan must be written for a fresh Opus session, with review checkpoints after each stage.

## Design

### 1. Games section + grid (index.html)

- New `// games` section on index.html (after `watch`, before `services` — same glass-panel + `<h2 class="section-label comment">` pattern as existing sections). Nav gets a lowercase `games` link (scroll anchor, `#games`).
- Responsive 2-column grid (1-col on narrow mobile), designed for N games. Each tile: thumbnail (`assets/games/{slug}-thumb.webp`, explicit width/height, `loading="lazy" decoding="async"` on below-fold tiles only), game name, and visible credit **"game by [Author]"** where the author name links to the source repo (`target="_blank" rel="noopener"`).
- No iframe exists in the DOM until a tile is clicked. Optional `<link rel="prefetch">` of the game's entry HTML on pointerdown/hover.
- No new inline `<script>` blocks (CSP hash churn) — game metadata (slug, name, author, repo URL, orientation preference) lives as data attributes on tiles or a small table in `script.js`.
- Styling: triple-comb passes (structure → polish → consistency) using `/hallmark` + `/frontend-design`, run in Stage 0 before any game is wired in. Lowercase aesthetic, AA contrast tokens (`--text-muted: #8f8f8f`), Reduce Motion respected.
- `llms.txt` updated in the same commit as page copy/section changes (verbatim-mirror rule). Copy for the section intro goes through content-workshop (Matthew's words) — placeholder-free shell can ship with minimal label text only.

### 2. Fullscreen overlay lifecycle (uniform for all games)

- One overlay component, single instance ever, idempotent open/close.
- **Open** (tile click): [music modal first if applicable, §3] → save `window.scrollY` → lock body scroll (`overflow:hidden; overscroll-behavior:none`) → `history.pushState` (back button closes) → create overlay + iframe via `createElement` (Trusted Types — **no innerHTML anywhere**) → `iframe.contentWindow.focus()` on load, re-focus on any overlay click → attempt `container.requestFullscreen()` inside the gesture handler; on rejection/absence (iPhone Safari) the CSS overlay IS fullscreen.
- Overlay CSS: `position:fixed; inset:0; height:100vh; height:100dvh; background:#000;` safe-area padding via `env(safe-area-inset-*)`; base viewport meta must carry `viewport-fit=cover` (verify/add in index.html).
- **Close** (X click, Escape, `fullscreenchange` exit, `popstate`): exit native fullscreen if active → destroy iframe (full unload — no background audio/CPU) → unlock scroll → `scrollTo` saved position → if game audio was playing i.e. "no" path, nothing to restore; catalog track (if "yes" path) just keeps playing.
- (X) button: parent-page element, sibling above iframe, top-right, safe-area padded, ≥44×44px tap target — identical across native-fullscreen and overlay paths (game always renders inside the overlay container even in native fullscreen).
- Failed iframe load → plain retry/close state, never an endless spinner.
- HexGL only: after fullscreen, try `screen.orientation.lock('landscape')`; on failure show a brief "rotate your device" hint; never block play.

### 3. Keep-listening modal + mute shim

- **Trigger:** tile click while store `<audio>` is actively playing (`!audio.paused`). Music not playing → no modal, game opens with its own audio untouched.
- **Modal:** accessible dialog (role=dialog, focus-trapped, Escape = cancel back to grid, focus returned to the tile). Copy (workshop-eligible, placeholder for now): "keep listening?" — two buttons: "keep my music" / "game audio". Asked on **every** game open while music plays.
  - **yes ("keep my music"):** iframe src gets `?mjmute=1`; catalog track continues under the overlay. Player bar is covered while the overlay is open (music keeps playing; controls return on close) — accepted trade-off.
  - **no ("game audio"):** pause catalog audio via the existing player, open game unmuted. (Catalog track is NOT auto-resumed on close — user can hit play; keeps behavior predictable.)
- **`mj-mute.js` shim:** tiny script vendored as the FIRST `<script>` in each game's `index.html` (one-line documented diff per game). If `location.search` contains `mjmute=1`:
  - Patch `HTMLMediaElement.prototype.play` to force `muted=true` first; define `volume`/`muted` accessors that pin muted state.
  - Wrap `AudioContext`/`webkitAudioContext` constructors so each created context's `destination` is fed through a zero-gain node (games connect to `ctx.destination` — the wrapper substitutes a silent proxy destination).
  - Runs before any game code → no race; catches floppybird's media elements and HexGL/Sandspiel Web Audio alike.
- Every game gets the shim regardless (inert without the query param) — uniform vendoring.

### 4. Files, headers, CSP, traffic hardening

Layout (repo root, served verbatim by Pages; `deploy.yml` prune step untouched):

```
index.html                     # + games section, modal, overlay markup hooks
script.js                      # + overlay/modal/lifecycle logic (external file — CSP-clean)
style.css                      # + grid/overlay/modal styles
assets/games/{slug}-thumb.webp # self-made thumbnails
games/2048/                    # vendored as-is + LICENSE + mj-mute.js
games/tiny-platformer/         # + LICENSE + mj-mute.js
games/floppybird/              # + LICENSE (Apache-2.0; retain NOTICE if present) + mj-mute.js
games/hexgl/                   # + LICENSE, downscaled textures/ only, license-header grep
games/sandspiel/               # built bundle + LICENSE, Firebase features stubbed
```

#### 4a. Vendor-time CSP normalization (best practice — per game, at vendor commit)

Each game goes through a documented normalization pass when vendored, so its route can carry a real CSP instead of `'unsafe-inline'`:

1. **Externalize inline `<script>` blocks** → files under the game's own folder (byte-for-byte move of the JS, no logic changes; diff documented in the game's vendor commit). Result: `script-src 'self'` suffices.
2. **Inline event handlers** (`onclick=` etc.): rewrite to `addEventListener` in the externalized file where trivial; where not trivial, pin with hash + `'unsafe-hashes'` scoped to `script-src-attr` for that slug only — never blanket `'unsafe-inline'`.
3. **Externalize inline `<style>` blocks** the same way → `style-src 'self'`. `style=""` attributes (common in game DOM manipulation, and set via CSSOM in most of these games — CSSOM is not gated) get `style-src-attr 'unsafe-inline'` only for slugs that actually parse-time-require it, documented per game.
4. **Audit greps at vendor time:** `eval(`/`new Function` (refactor tiny usages rather than grant `'unsafe-eval'`), `document.write`, external URLs (fonts/CDNs/analytics — strip or self-host), stray license headers (HexGL).
5. **Trusted Types are NOT enforced on game routes** (games use `innerHTML` internally; enforcing means forking game logic). Accepted deliberately: code is same-origin, vendored, frozen, audited, and `connect-src 'self'` + `form-action 'none'` cap exfiltration paths. Documented in `_headers` comment, mirroring the existing zone-features comment style.

`_headers` additions — **per-slug least-privilege policies** (each game gets only what its audit shows it needs; representative examples):

```
# vendored games: framed by index.html only. Site-wide strict CSP + XFO: DENY
# detached per route; each slug carries its own least-privilege policy derived
# from its vendor-time audit. No Trusted Types here (games use innerHTML
# internally); exfil capped by connect-src/form-action instead.
/games/2048/*
  ! X-Frame-Options
  ! Content-Security-Policy
  X-Frame-Options: SAMEORIGIN
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'

/games/hexgl/*
  ! X-Frame-Options
  ! Content-Security-Policy
  X-Frame-Options: SAMEORIGIN
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self'; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'

/games/sandspiel/*
  ! X-Frame-Options
  ! Content-Security-Policy
  X-Frame-Options: SAMEORIGIN
  Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'

# game assets are immutable vendored files
/games/*/js/*
  Cache-Control: public, max-age=31536000, immutable
# (same pattern per asset dir: css, img, assets, textures, sounds — enumerate per game at vendor time)
```

(Exact directive sets per slug are finalized from the vendor-time audit — the examples above encode the expected needs: 2048 = plain DOM/CSS; HexGL = Three.js blob/data textures + CSSOM style attrs; Sandspiel = wasm instantiation, which under CSP3 requires `'wasm-unsafe-eval'`, NOT full `'unsafe-eval'`. tiny-platformer/floppybird follow the 2048 shape, floppybird + media-src for its audio.)

- **Verify during implementation:** Cloudflare Pages `_headers` header-detach syntax (`! Header-Name`) against current CF docs before relying on it; if unsupported for a header set at a broader scope, restructure rules (move strict CSP off `/*` onto explicit non-game paths).
- **Verify per game before its gate:** full playthrough with devtools console open — zero CSP violations on the deployed route (`_headers` is edge-only, so this check runs post-deploy, same as the site's existing CSP discipline). If a game misbehaves under its policy in production, temporarily switch that slug's header to `Content-Security-Policy-Report-Only` to diagnose, then re-enforce.
- Game entry HTML stays on default revalidate caching.
- Sandspiel: test empirically for SharedArrayBuffer; add COOP/COEP scoped to `/games/sandspiel/*` only if required.
- Main-page CSP: **no changes needed** — `frame-src` falls back to `default-src 'self'`; overlay/modal JS lives in `script.js`. Inline-block hashes untouched unless store-data JSON changes (it doesn't).
- **Traffic/scale hardening:** everything static + edge-cached (Pages free tier is unmetered for static); zero per-player server cost; landing weight deferred until click (no iframes in DOM, thumbnails only); immutable caching on all game assets so repeat/viral traffic hits edge cache; audit every game against 25 MiB/file + 20k files/site limits and log counts in each PR; anything over 25 MiB moves to R2 or is dropped, never fought.
- Licenses: each game folder retains its original LICENSE file (MIT/Apache-2.0 letter-of-license requirement) in addition to the visible credit link.

### 5. Phasing (each stage = Opus execution unit, Fable review checkpoint after)

- **Stage 0 — shell:** nav link, section, grid with placeholder tiles, overlay + modal + lifecycle fully working against a trivial local test page in the iframe; `mj-mute.js` written + unit-poked; `_headers` rules added; triple-comb styling passes. Gate: lifecycle passes device matrix with test page; Lighthouse mobile stays ≥ 90 (baseline 98).
- **Stage 1 — drop-ins:** 2048 → tiny-platformer → floppybird, one commit each (vendor + §4a CSP normalization pass + LICENSE + shim + thumbnail + tile + per-slug `_headers` policy). Gate per game: device matrix + zero CSP violations on deployed route.
- **Stage 2 — HexGL:** §4a normalization + asset audit (25 MiB, downscaled `textures/`, per-file license-header grep), touch controls (`CONTROLS=TOUCH, PLATFORM=MOBILE`), orientation hint, sensible mobile quality preset. Gate: playable FPS on mid-range Android + zero CSP violations deployed.
- **Stage 3 — Sandspiel:** local Rust→wasm build (documented, built bundle vendored — no repo build step), §4a normalization (`'wasm-unsafe-eval'` only, never `'unsafe-eval'`), Firebase upload/browse stubbed with no dead buttons, ⓘ tooltip ("offline sandbox version…" per brief §5.1), conditional COOP/COEP. Gate: sim runs on all device classes; zero Firebase network calls; zero CSP violations deployed. **Defer rather than degrade** if the build turns into a time sink.

### 6. Device test matrix (gate for every game)

desktop Chrome/Firefox · desktop Safari · Android Chrome phone · iPhone Safari · iPad Safari. Per class: fullscreen opens (native or fallback, indistinguishable); input works immediately (keyboard focus / first tap); X + Escape + back button close and restore scroll; no background scroll/rubber-band; X never behind notch; rapid open/close leaks nothing. Plus the music axis: modal appears only while music playing; "keep my music" = game silent + track uninterrupted; "game audio" = track paused + game audible.

### 7. Verification

- `superpowers:verification-before-completion` before any "done" claim.
- Browser runthrough each stage with superpowers-chrome (`use_browser`) against a local server — **note:** `_headers` is edge-only, so CSP/XFO/cache behavior must additionally be verified on the deployed site (curl + devtools) after deploy.
- Header checks: confirm relaxed CSP + SAMEORIGIN on `/games/*` responses, strict CSP still on `/`, immutable cache-control on game assets.
- Audio checks: play catalog track → open each game → both modal paths behave; verify with WebAudio/media inspection that the muted path emits nothing.
- Lighthouse mobile on landing after every stage; file-count + largest-file logged per PR.

## BDD scenarios

Story: Play a game from the grid
- Given the games section on the page, When I click a tile with no music playing, Then the game opens fullscreen with its own audio and the (X) closes it back to my exact scroll position.
- Given a game open in the overlay, When I press Escape or the browser back button, Then the overlay closes, the iframe is destroyed (no audio/CPU), and the page did not navigate away.
- Given a tile, When I double-click it rapidly, Then exactly one overlay instance exists.

Story: Keep listening while playing
- Given a catalog track is playing, When I click a game tile, Then a dialog asks whether to keep my music before the game opens.
- Given that dialog, When I choose "keep my music", Then the track keeps playing uninterrupted and the game runs fully silent (music and SFX).
- Given that dialog, When I choose "game audio", Then the catalog track pauses and the game's audio plays as shipped.
- Given no catalog track playing, When I open a game, Then no dialog appears.

Story: Attribution
- Given any game tile or its overlay chrome, When I look at it, Then "game by [Author]" is visible and the author's name links to the source repo in a new tab.
- Given any deployed game folder, When I fetch `/games/<slug>/LICENSE*`, Then the original license text is served.

## Open dependencies (deliberate, not TBDs)

- Modal + section-intro copy: Matthew authors via content-workshop before final copy lands; shell ships with minimal placeholder labels.
- Per-slug CSP directive sets: finalized from each game's vendor-time audit (§4a); the examples in §4 encode expected needs.
- Cloudflare Pages `! Header-Name` detach syntax: verify against current CF docs at Stage 0 before relying on it.

Next step: implementation plan (per stage, written for the Opus executor with Fable review checkpoints between stages).
