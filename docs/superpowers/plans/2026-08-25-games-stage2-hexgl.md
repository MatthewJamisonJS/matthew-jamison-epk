# Games Stage 2 — HexGL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship HexGL (Thibaut Despoulain / BKcore, MIT) as the fourth game: WebGL racer, playable desktop + touch, auto quality preset by device, orientation hint, zero CSP violations deployed.

**Architecture:** Same shape as Stage 1 (spec §4/§4a/§5 Stage 2 — `docs/superpowers/specs/2026-08-24-games-section-design.md` is binding): vendor runtime files into `games/hexgl/`, per-slug least-privilege `_headers` CSP with directive-by-directive evidence, mj-mute.js first script, tile + thumbnail + llms.txt, preview-deploy gate. Stage 1 precedents govern: m4a audio fallback (floppybird), viewport `user-scalable` strip, evidence comments, data-controls instruction line.

**Tech Stack:** Three.js r53-era WebGL, vendored static; ffmpeg for audio; headful CDP verification (headless throttles rAF to ~1FPS — never verify canvas gameplay headless).

**Controller recon of upstream (BKcore/HexGL @ 6addc95a — verify on your own clone):**
- ~15M runtime content, largest file <5.2M (25MiB limit safe). SHIP: `index.html, launch.js, css/, bkcore/, bkcore.coffee/*.js (compiled JS only), libs/ (subset), textures/ (4.2M downscaled set), geometries/, audio/, favicon.png, LICENSE`. EXCLUDE: `textures.full/ (5.2M), libs/Editor.html + libs/Editor_files/, libs/Three.r53.js (unused duplicate — verify index.html loads Three.dev.js), replays/, *.coffee sources, cache.appcache, manifest.webapp, package.webapp, package.zip, icon_*.png (webapp icons), README.md`.
- index.html carries: an inline `<style>` block (externalize per §4a), an inline Google Analytics script (STRIP), external favicon links to hexgl.bkcore.com (point at the local `favicon.png` instead), og:/fb: meta tags for bkcore.com (STRIP — this copy serves on matthewjamison.dev), `viewport … user-scalable=no, maximum-scale=1.0` (strip both per Stage 1 WCAG 1.4.4 precedent, keep width/initial-scale).
- `launch.js:106` redirects the iframe to `http://get.webgl.org/` when WebGL is missing — rewrite to an in-page message (documented diff; never navigate the iframe off-origin).
- `libs/leap-0.4.1.min.js` + the Leap flow: Leap's JS opens a WebSocket to `ws://127.0.0.1:6437` when a Controller is constructed — under `connect-src 'self'` that's a console violation. AUDIT whether launch.js/HexGL.js constructs it unconditionally; if yes, strip the Leap path (script tag + controller wiring, documented); if constructed only behind a setting, still strip — dead peripheral.
- `libs/Stats.js` + `libs/DAT.GUI.min.js`: audit whether they're instantiated outside godmode/debug; if debug-only, keep files but confirm no runtime cost; if drawn on screen by default, disable per FPSMeter precedent (owner already ruled HUD-stripping OK).
- audio/ = 5 .ogg (bg, boost, crash, destroyed, wind) + its own LICENSE file (KEEP — per-file license carve-out from the README). Safari/iOS silent on ogg → transcode m4a and add fallback in `bkcore/Audio.js` (audit its mechanism first: HTML5 Audio elements vs WebAudio; smallest diff that tries m4a where ogg unsupported). Mute shim must cover whichever mechanism it uses — verify with the shim's readouts.
- Geometries load via XHR (Three.js loaders) → `connect-src 'self'` earned. Textures via Image()/THREE.ImageUtils → `img-src 'self'` (+ `blob:`/`data:` ONLY if the audit shows blob/data URLs — spec's example expects them, but prove it). Shaders are inline JS strings (fine). Expect `style-src-attr 'unsafe-inline'` ONLY if the DOM HUD sets style attributes via setAttribute/cssText at parse-time paths — CSSOM `.style.prop =` is NOT gated; audit before granting anything.

**Global constraints (binding):** branch `games-stage2` from main; NEVER push to main unasked; commits signed (op-ssh-sign works — if it errors, STOP); no AI attribution; main-page CSP contract untouched (both pinned hashes); lowercase aesthetic; llms.txt verbatim mirror in the same commit as page changes; every `_headers` directive (and omission) evidence-justified; deploy-limit log per commit; license-header grep across ALL vendored dirs (README carve-out: "unless specified in the file" — record every per-file license found, e.g. audio/LICENSE, Nobiax track texture credits).

---

### Task 1: Vendor + normalize HexGL

**Files:** Create `games/hexgl/**`; Modify `_headers`.

- [ ] Story: In order to race in the browser, a visitor clicks the HexGL tile and plays at a playable framerate on their device with zero setup.
  - Given the tile clicked on desktop, When the game loads, Then the menu appears, a race starts with keyboard controls, and no CSP violation is logged.
  - Given a touch device, When the game loads, Then controls default to touch and quality to the mobile preset.
  - Given no WebGL, When the game loads, Then an in-page message shows — the iframe never navigates away.
- [ ] Clone `https://github.com/BKcore/HexGL` (canonical ONLY — forks carry the old CC BY-NC license) to scratch; record SHA; copy the SHIP list above into `games/hexgl/`; verify EXCLUDE list absent; `du -sh` + largest-file log.
- [ ] §4a normalization (each a documented diff in the commit body): externalize the inline `<style>` to `games/hexgl/css/page.css`; strip GA block; strip og/fb metas; local favicon; viewport fix; rewrite the get.webgl.org redirect to an in-page message reusing the game's own `#step-2`-style text ("this device doesn't support webgl."); strip Leap (script tag + wiring) per audit; Stats/DAT.GUI per audit; add `<script src="../mj-mute.js"></script>` as FIRST script.
- [ ] Audio: ffmpeg-transcode 5 oggs → m4a (aac 96k), extend `bkcore/Audio.js` with the smallest working fallback; keep `audio/LICENSE`.
- [ ] Audit greps (run + record): `eval(`/`new Function` · `document.write` · external `https?://` and `ws://` in all shipped js/css/html · `.volume` read-then-write fade loops · `autoplay` · Escape/keyCode 27 (game must not swallow Escape) · per-file license headers in textures/, geometries/, audio/, bkcore/, libs/ · `setAttribute('style'`/`cssText` (for the style-src-attr decision) · `blob:`/`createObjectURL`/`data:` (for img-src).
- [ ] `_headers`: `/games/hexgl/*` block mirroring the Stage 1 detach pattern (`! X-Frame-Options`, `! Content-Security-Policy`, `X-Frame-Options: SAMEORIGIN`, `X-Robots-Tag: noindex`) + least-privilege CSP derived from the audit (expected shape: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'[ blob: data:]; media-src 'self'; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'` — adjust ONLY on evidence, with the directive-by-directive comment). Immutable cache rules per asset dir (textures, geometries, audio, libs, bkcore, css assets); entry HTML stays revalidate.
- [ ] Verify (headful, CSP replay of the exact shipped policy, Stage 1 harness pattern): menu loads, one full race start, zero violations/failed requests; `?mjmute=1` run silent (shim readout on whatever Audio.js uses) with a store track uninterrupted.
- [ ] Commit: `add: hexgl by thibaut despoulain (vendored @ <sha8>, csp-normalized)` — body lists every diff, grep transcripts, per-file license findings, deploy-limit numbers.

### Task 2: Device adaptation — auto preset, touch, orientation

**Files:** Modify `games/hexgl/launch.js` (or its settings init), `script.js`, `index.html`, `style.css`; Create `assets/games/hexgl-thumb.webp`.

- [ ] Story: In order to play on a phone, a visitor gets touch controls, mobile quality, and a rotate hint — without touching a menu.
  - Given a coarse-pointer device, When HexGL opens, Then quality defaults to the mobile preset and controls to touch.
  - Given a phone in portrait, When the game opens, Then a brief "rotate your device" hint shows; play is never blocked.
- [ ] In HexGL's settings init: default quality by `matchMedia('(pointer: coarse)')` → mobile preset (upstream's Mobile/low equivalents: renderer scale, no postprocessing per its quality table — read launch.js's quality definitions and pick the upstream-defined levels, don't invent values); controls → touch on coarse pointer (upstream `controlType`); desktop stays upstream default quality Mainstream/High + keyboard. Menu still lets the player change both (don't remove choice). Documented diff.
- [ ] Orientation (parent page, spec §2): tile gets `data-orientation="landscape"`; in `script.js` openGame, after the fullscreen attempt, if `open.tile.dataset.orientation` try `screen.orientation.lock(value).catch(...)`; on rejection AND `matchMedia('(orientation: portrait)')`, show a brief dismissable hint line (reuse the overlay chrome; textContent only; auto-hide on orientationchange to landscape). Never block play. Unlock on close (`screen.orientation.unlock()` in closeGame, try/catch).
- [ ] Tile: after floppybird; pattern identical to Stage 1 tiles; credit `game by <a href="https://github.com/BKcore/HexGL" …>Thibaut Despoulain</a>`; `data-controls` draft: `arrows steer · touch: tilt zones` (verify wording against the actual touch scheme found in Task 1's audit — fix to match reality; owner approves final copy); thumbnail 700x525 webp from real gameplay (headful).
- [ ] llms.txt entry, page order, same commit as the tile.
- [ ] Verify (headful): desktop run keyboard; emulated coarse pointer run → touch+mobile defaults; orientation hint logic via `set_viewport` mobile emulation; both music-dialog paths; rapid open/close leak check.
- [ ] Commit: `feat: hexgl tile — auto preset by device, orientation hint, touch default`.

### Task 3: Stage gate (controller + owner)

- [ ] Preview deploy (CI-replica scratch: prune worker/docs, sed `?v=dev`→sha8 in index.html AND 404.html, esbuild-minify style.css/script.js, `wrangler pages deploy --project-name=matthew-jamison-epk --branch=games-stage2`).
- [ ] Header curls on `/games/hexgl/` (final response: own CSP + SAMEORIGIN + noindex), `/` strict CSP intact, immutable cache sample on a texture + a geometry.
- [ ] Headful playthrough on the preview: full race, zero violations; keep-my-music silent run; Lighthouse ≥ 90 on landing; file-count/largest-file log.
- [ ] **Owner gate (Matthew):** playable FPS on his mid-range Android (spec Stage 2 gate) + device matrix §6 on the preview + `data-controls` copy approval. Merge only on his word.

### Then

Stage 3 (Sandspiel) gets its own plan: toolchain check-first ruling stands (missing: wasm-pack + wasm32-unknown-unknown target — ask before installing), Firebase stubbing, ⓘ tooltip, `'wasm-unsafe-eval'`, empirical SharedArrayBuffer → scoped COOP/COEP, defer-over-degrade.
