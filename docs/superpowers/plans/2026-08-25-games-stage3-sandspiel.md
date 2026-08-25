# Games Stage 3 — Sandspiel (offline sandbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the offline-sandbox build of Sandspiel (Max Bittker, MIT): full falling-sand sim, community/upload/browse features stubbed with no dead buttons, ⓘ tooltip explaining the difference, zero network calls to Firebase/Sentry/any third party.

**Architecture:** Rust→wasm built LOCALLY (documented commands in the vendor commit; the repo gains only the built bundle under `games/sandspiel/` — no build step in this repo). Spec §5.1 + §5 Stage 3 binding (`docs/superpowers/specs/2026-08-24-games-section-design.md`). **Defer rather than degrade**: if the build or stubbing turns into a time sink, report BLOCKED — never ship a broken sim.

**Tech Stack:** Rust (installed: rustc 1.93.1) + wasm32-unknown-unknown target + wasm-pack (both just installed) + node 25 / npm 11; upstream webpack build via `@wasm-tool/wasm-pack-plugin`.

**Controller recon (upstream MaxBittker/sandspiel @ dc77827b — advisory, re-verify):**
- `package.json` scripts: `build` = `webpack --mode=production` (the wasm-pack plugin builds `crate/` automatically — the brief's separate `cd crate && wasm-pack build` is superseded by the plugin; document actual commands used).
- React app (`js/components/`), deps include `firebase`, `firebase-admin`, `react-firebaseui`, `@sentry/*` (browser/react/tracing/wasm), `react-youtube`, `dat.gui`, `regl` (fluid shaders), `timeago.js`. Both `pnpm-lock.yaml` and `yarn.lock` exist, no package-lock — pick ONE package manager, record which and why.
- Stub surface: `js/api.js` (backend calls), `js/components/{browse,signin,signinButton,admin}.js`, any upload/vote/share UI in `ui.js`, Sentry init, `react-youtube` embeds, workbox service worker (`workbox-webpack-plugin`), `manifest.json`/webmanifest PWA plumbing, `index.html` inline scripts (lines ~51-62 — likely analytics/SW registration; externalize what stays, strip what goes).
- `grep -rn SharedArrayBuffer js/ crate/src` → zero hits: expect NO COOP/COEP (verify empirically in the built bundle before deciding headers).
- Known risk: older webpack against node 25 can hit `ERR_OSSL_EVP_UNSUPPORTED` — remedy is `NODE_OPTIONS=--openssl-legacy-provider` for the build shell (document if used), or a minimal webpack bump ONLY if unavoidable (document).
- LICENSE (MIT) at repo root — vendor it. Run the per-file license grep anyway (Stage 2 lesson: the grep is load-bearing; STOP for a ruling on any non-MIT header).

**Global constraints (binding):** branch `games-stage3` from main; NEVER push main unasked; signed commits (STOP on sign error); no AI attribution; main-page CSP contract untouched; lowercase aesthetic; llms.txt verbatim mirror in the tile commit; `_headers` per-slug least-privilege with per-directive evidence (expected: `script-src 'self' 'wasm-unsafe-eval'` — NEVER full `'unsafe-eval'`); headful-only canvas verification; deploy-limit log (wasm + textures can be chunky — largest-file check matters here).

---

### Task 1: Build pipeline bring-up (vanilla, unmodified)

- [ ] Story: In order to vendor a trustworthy bundle, the build must reproduce from clean upstream before anything is changed.
  - Given a clean clone at a recorded SHA, When the documented commands run, Then `dist/` contains a servable bundle whose sim runs locally.
- [ ] Clean clone → record SHA. Install deps (choose package manager per lockfile actually honored; record versions: node, npm/pnpm, wasm-pack, rustc). Run the production build; capture the exact command sequence + any env vars (openssl-legacy etc.) verbatim for the vendor commit.
- [ ] Serve `dist/` locally (fresh port), headful: sim boots, elements paintable, fluid runs. Record which network requests the VANILLA build makes (this is the baseline kill-list for Task 2): firebase, sentry, fonts, youtube, anything.
- [ ] No commit (nothing in-repo yet) — report only. BLOCKED if the build fights back (defer-over-degrade).

### Task 2: Stub pass + rebuild (offline sandbox)

- [ ] Story: In order to play offline-only, a visitor gets the full sim with zero community features and no dead buttons.
  - Given the stubbed build, When the sim runs through a painting session, Then the Network tab shows zero third-party requests and no UI element leads nowhere.
  - Given the ⓘ affordance, When clicked/hovered, Then the tooltip explains the offline sandbox plainly.
- [ ] In the scratch clone, remove/stub (each a listed diff): Sentry init + deps from the entry; firebase init, api.js network paths, browse/signin/admin components and their mount points; upload/share/vote buttons OUT of the UI (not disabled — gone); react-youtube; workbox/service-worker registration + PWA manifests; index.html inline scripts externalized or stripped per §4a.
- [ ] ⓘ tooltip near the game title in the OVERLAY CHROME (parent page owns it — coordinate with Task 3's tile work): copy VERBATIM from the brief §5.1: "This is the offline sandbox version of Sandspiel. The community gallery — uploading and browsing other players' creations — is disabled here. Every element and physics interaction works exactly like the original. For the full community experience, visit sandspiel.club." (workshop-eligible; lowercase-adapt only if Matthew's convention demands — flag, don't decide).
- [ ] Mute shim: audit whether the sim has ANY audio (grep AudioContext/Audio( in js/ + crate). None expected — if none, shim still vendored as first script (uniform vendoring rule), note inert.
- [ ] Rebuild; headful run: full paint session, ZERO non-self requests (record the Network evidence), no dead buttons, dat.gui/debug panels not user-visible unless upstream ships them visible.
- [ ] Report with the complete stub diff list (this becomes the vendor commit body). Still no in-repo commit.

### Task 3: Vendor + integrate

**Files:** Create `games/sandspiel/**` (dist output + LICENSE + mj-mute.js reference), `assets/games/sandspiel-thumb.webp`; Modify `index.html`, `script.js` (only if tooltip needs wiring), `style.css` (tooltip), `_headers`, `llms.txt`.

- [ ] Copy the stubbed `dist/` into `games/sandspiel/` + upstream LICENSE + shim first-script in its index.html (post-build edit if webpack owns the HTML — document). Webpack hashed filenames are fine (immutable cache rule can cover the whole slug's asset paths — but entry HTML stays revalidate).
- [ ] Tile after hexgl's eventual slot (currently after floppybird), pattern identical to Stage 1; credit `game by <a href="https://github.com/MaxBittker/sandspiel" …>Max Bittker</a>`; `data-controls` draft: `draw with elements · pick from the palette` (fix to reality; owner approves). Thumbnail 700x525 from a real painted scene.
- [ ] ⓘ tooltip in overlay chrome (from Task 2's design): accessible (button + aria-describedby or equivalent; no title-attr-only), textContent only, keyboard reachable.
- [ ] `_headers` `/games/sandspiel/*`: detach pattern + SAMEORIGIN + noindex + CSP from evidence — expected `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' [data:|blob: on evidence]; connect-src 'self' [only if the wasm fetch needs it — wasm loaded via fetch DOES need connect-src 'self']; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`. COOP/COEP ONLY if the built bundle provably uses SharedArrayBuffer (recon says no — verify). Immutable cache on hashed assets.
- [ ] llms.txt same commit. Audit greps on the SHIPPED bundle (external URLs especially — bundlers inline dep URLs; grep dist for `https?://` and kill any live ones).
- [ ] Headful CSP-replay: paint session, zero violations, zero third-party requests; `?mjmute=1` run (inert or muted per audit); keep-my-music path once locally.
- [ ] Commit: `add: sandspiel by max bittker (vendored @ <sha8>, offline sandbox, csp-normalized)` — body: build commands verbatim, toolchain versions, full stub list, grep transcripts, deploy-limit numbers.

### Task 4: Stage gate (controller + owner)

- [ ] Preview deploy (CI-replica; sed covers index.html + 404.html); header curls; headful playthrough on preview (sim on all fours = Matthew's device matrix); Lighthouse ≥ 90; file counts.
- [ ] DevTools Network on the preview: zero Firebase/Sentry/third-party requests (spec's Stage 3 gate, verify again at edge).
- [ ] **Owner gate:** device matrix §6 + tooltip/`data-controls` copy approval. Merge only on his word.

### Then

HexGL (Stage 2) resumes when BKcore answers issue #76 — the paused branch `games-stage2` holds the plan; the Task 1 audit report has the ready-to-execute normalization list.
