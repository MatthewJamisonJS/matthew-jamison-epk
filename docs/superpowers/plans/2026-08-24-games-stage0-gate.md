# Games Stage 0 — Gate & Handoff Plan (split from the shell plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out Stage 0 of the games section: run the verification gate (the original plan's Task 9), resolve the carried findings from Tasks 1–8 reviews, and hand the branch to merge/deploy.

**Architecture:** Everything is already built on branch `games-stage0` (Tasks 1–8 complete, each reviewed; see `.superpowers/sdd/2026-08-24-games-stage0-shell/progress.md` for the full ledger). This plan verifies, patches only what verification proves broken, and finishes the branch. Spec: `docs/superpowers/specs/2026-08-24-games-section-design.md`. Prior plan: `docs/superpowers/plans/2026-08-24-games-stage0-shell.md` (its Task 6 Step 4 checklist is referenced below).

**Tech Stack:** Static site; superpowers-chrome browser checks; Lighthouse; curl for deployed headers.

**Executor notes:**
- Branch `games-stage0`, main untouched at `4d74440`. Commits `9363def..d930961` are the stage's work.
- Local server: `python3 -m http.server <fresh-port>` per run — `script.js?v=dev`/`style.css?v=dev` cache HARD; a fresh port is the reliable bust (deploy rewrites `?v=dev`→SHA, so this is dev-only).
- Headless screenshots of the main page render black — verify via DOM/JS evaluation. The MCP browser never dispatches `fullscreenchange`; native-fullscreen checks need genuinely headful Chrome with trusted CDP input.
- `_headers` is edge-only: header assertions run against the DEPLOYED site only.
- Git: NEVER add AI co-author attribution. Ask before pushing/merging — push to main triggers deploy.

---

### Task 1: Local verification gate (original plan's Task 9, local half)

REQUIRED SUB-SKILL: `superpowers:verification-before-completion`.

- [ ] **Full acceptance re-run:** every check in the shell plan's Task 6 Step 4 (9 items), in order, on a fresh port. Music-modal items need real store playback (api.matthewjamison.dev reachable; browser UA required).
- [ ] **Mobile widths re-check:** 360/390/768 — tile grid 1-col ≤560px, dialog centered (0px offset both axes) and fully on-screen at 360, no horizontal scroll at any width.
- [ ] **Reduced-motion:** emulate `prefers-reduced-motion: reduce`; open/close a game — no ambient animation, hover/press feedback may remain (site pattern).
- [ ] **Fullscreen-close focus check (carried Task 8 finding):** in HEADFUL Chrome with trusted CDP click, enter native fullscreen, Escape out, then evaluate `document.activeElement`. Expected: the game tile. If it is `<body>`, the cause is `exitFullscreen()` resolving after `focus()` — fix by re-focusing the tile in the exit promise: in `closeGame`, change the exit call to `document.exitFullscreen().then(() => { closed.tile.focus({ preventScroll: true }); }).catch(() => {})` (keep the existing synchronous focus call for the CSS-overlay path). Commit `fix: re-focus tile after native fullscreen exit` ONLY if the check fails.
- [ ] **Lighthouse mobile:** `npx lighthouse http://localhost:<port>/ --preset=mobile --quiet` → performance ≥ 90 (baseline 98). Log the four scores.
- [ ] **Deploy-limit report:** `git ls-files | wc -l` and largest file (`find . -type f -not -path './.git/*' -size +20M`) — record against Pages 20k-file / 25 MiB limits.

### Task 2: Merge decision + deploy (user-gated)

- [ ] Present Task 1 results to the user. Use `superpowers:finishing-a-development-branch`. Merging `games-stage0` → main pushes the site live (GitHub Actions deploys on push to main) — the user decides.

### Task 3: Deployed verification (original Task 9, edge half — after deploy)

- [ ] **BLOCKING header check (carried Task 1 ruling — detach-then-set precedence is undocumented):**
  `curl -s -D - -o /dev/null -H "User-Agent: Mozilla/5.0" https://matthewjamison.dev/games/_test/index.html`
  Must show: `x-frame-options: SAMEORIGIN`, the games CSP (`frame-ancestors 'self'`, NO `require-trusted-types-for`), and `x-robots-tag: noindex`. If the `!` detach left the route with NO CSP/XFO at all, stop and restructure `_headers` (move the strict CSP off `/*` onto explicit non-game paths) before any real game ships.
- [ ] Same curl against `https://matthewjamison.dev/` → strict CSP unchanged (both sha256 hashes present, `require-trusted-types-for` present).
- [ ] Live smoke: open the deployed page in a real browser, run one full open/close cycle + one keep-my-music cycle on the test tile; console must show zero CSP violations.
- [ ] **Device matrix handoff (user hardware):** iPhone Safari, iPad Safari, Android Chrome, desktop Safari/Firefox — spec §6 checklist plus: safe-area insets (X never behind notch; emulation resolved them to 0, unverified), WebKit/Firefox mute-shim behavior (`/games/_test/index.html?mjmute=1` readouts), music-axis checks. Report readiness; do NOT claim the gate passed on the user's behalf.

### Task 4: Owner decisions to collect (carried from reviews — present, don't implement unasked)

- [ ] Page-wide AA lift: global `:focus-visible` ring (2.70:1) and `a:hover`/`.btn-ghost:hover` accent text (2.68:1) fail AA site-wide; games got scoped fixes, so the site has two focus vocabularies. Ask Matthew: lift the games treatment page-wide?
- [ ] Copy pass via content-workshop (Matthew's words): games section intro (if any), dialog copy ("keep listening?" / buttons), tile placeholder — before Stage 1 ships real games.
- [ ] Blank-frame-on-404 behavior (by design; LOAD_BUDGET catches stalls only) — confirm acceptable for Stage 1.

### Then

Stage 1 (vendor 2048 → tiny-platformer → floppybird) gets its own plan after this gate passes — per the spec's phasing and the Fable-review checkpoint model. Stage 1 vendor checklist carry-ins recorded in the shell ledger: volume read-then-write fade-loop grep per game (mute shim pins volume getter to 0); games must not globally swallow Escape; per-slug `_headers` policies from vendor-time audits.
