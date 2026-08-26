# Floppy Bird mobile performance fix

## Context

Floppy bird (`games/floppybird/`, stock nebez/floppybird drop-in from games Stage 1) is choppy and has tap-to-flap lag on mobile. Root causes, confirmed in source:

1. `setInterval(gameloop, 1000/60)` (main.js:126) — not vsync-aligned, drifts and stacks against the browser paint clock.
2. Layout thrash every tick: `getBoundingClientRect()` on the player, `$("#land").offset()`, `ceiling.offset()`, pipe `offset()/height()` (main.js:153–197), each read immediately after style writes → forced reflow 60×/s.
3. Bird moves via `top` + jQuery transit rotate (main.js:139) — layout property, no compositing.
4. Pipes animate `left` in CSS keyframes (main.css:52–67 `animPipe`) — layout + paint per frame per pipe.
5. Sky/land/ceiling scroll via `background-position` keyframes — large repaints every frame (sky is 80% of the viewport).
6. jQuery object churn in the hot loop (`$("#player")` per tick).

Approach chosen by Matthew: **A + parent pause** — surgical modernization of the hot path (keep jQuery for splash/score screens), plus pausing the main page's ambient animations while the game overlay is open. No canvas rewrite, no library removal.

## Changes

### 1. Game loop → rAF fixed timestep (`games/floppybird/js/main.js`)

- Replace `setInterval(gameloop, updaterate)` with a `requestAnimationFrame` driver + fixed-timestep accumulator (step = 1000/60 ms; run physics N steps per frame, render once). Cancel via `cancelAnimationFrame` in `playerDead()`.
- Keep the 1400 ms pipe-spawn `setInterval` (not per-frame; fine as is).
- Cache DOM refs once at start (`player` element, flyarea height already cached in `flyArea`).

### 2. Pure-math collision — zero DOM reads in the loop

- Bird: x is fixed (CSS `#player { left: 60px }`), y = existing `position` var, size 34×24 known constants. Reproduce the existing rotation-shrunk bounding box from those constants instead of `getBoundingClientRect`.
- Ground: dead when bird bottom ≥ `flyArea` (land top). Ceiling: clamp `position` at 0 (existing logic, numeric already).
- Pipes: stop using CSS `animPipe`. Each pipe gets a numeric `x` (spawn at flyarea width, move left at the same speed the 7500 ms/1000 px animation gave ≈ 0.1333 px/ms), advanced in the physics step and rendered with `transform: translateX()`. Collision + scoring compare numeric pipe x / gap heights (gap top/bottom already computed at spawn in `updatePipes`) — no `offset()` calls. Remove pipe when x < −100 (replaces the `$(".pipe").filter(...position().left...)` sweep, another reflow source).

### 3. Compositor-friendly rendering (`main.js` + `css/main.css`)

- Bird: single `element.style.transform = translate3d(0, <position>px, 0) rotate(<deg>)` per frame (CSSOM write — CSP-safe, matches site convention). Base CSS `top: 0` on `#player`; keep `left: 60px`. Death-drop animation can keep transit (not hot path) but must compose with the new transform origin — simplest: keep using transit's `y`/`rotate` on death since the loop is stopped by then.
- Pipes: delete `animPipe` keyframes; pipes are `left: 0` + JS-driven `translateX`. `will-change: transform` on `.pipe` and `#player`.
- Sky/land/ceiling: convert `background-position` keyframes to transform-scrolling — each strip becomes a child element 2× viewport width with the repeating background, animated `translateX(0 → −tile-width)` loop, `will-change: transform`. (Sky repaint is the single biggest paint cost on mobile.)

### 4. Input latency (`css/main.css` + `main.js`)

- `touch-action: manipulation` on `html, body` in the game's CSS (kills tap-delay/gesture arbitration inside the iframe).
- Replace jQuery `$(document).on("touchstart", screenClick)` with native `document.addEventListener("touchstart", screenClick, { passive: true })`.

### 5. Parent-page pause while a game is open (`script.js` + `style.css`)

- In the overlay open/close code (script.js ~831–1040): toggle a `game-open` class on `<html>` or `<body>` when the overlay opens/closes (including the error/close paths).
- `style.css`: under `.game-open`, set `animation-play-state: paused` on the ambient/orb animation layers (and any other purely-ambient keyframe consumers). Do NOT touch user-initiated feedback per the Reduce Motion convention. Follows existing class-toggle patterns already in script.js.

## Constraints

- CSP: no inline styles/`innerHTML` anywhere — all style writes via CSSOM (`style.transform`, `.css()`), matching the existing pipe-height comment in main.js:457–459.
- Keep splash/score/replay screens, cookie high score, `?easy`/`?debug`/`?mjmute=1` behavior identical.
- Minimal diff; upstream file stays recognizable (Matthew's chosen approach A).
- Work on a branch (games branches pattern: `games-stage*`); merge gate = device check.

## BDD acceptance scenarios

Story: smooth floppy bird on a phone
- Given the game running under Chrome DevTools mobile emulation with 6× CPU throttle, When a 10 s performance trace is recorded during play, Then the gameloop produces no forced-reflow warnings and no long tasks > 50 ms.
- Given the player taps the screen mid-game, When touchstart fires, Then velocity is applied before the next paint (flap visible next frame).
- Given the game overlay is open, Then the parent page's ambient animations are paused; When the overlay closes, Then they resume.

## Verification

1. `python3 -m http.server` from repo root; open `/games/floppybird/` directly and via the overlay on `/`.
2. DevTools → mobile emulation + 6× CPU throttle → Performance trace during play: confirm ~16 ms frames, no `[Violation] forced reflow` in the gameloop, pipes/bird on compositor layers (Layers panel).
3. Regression pass: splash → play → score → medal → replay; high-score cookie persists; `?easy`, `?debug` (bounding boxes must still track the bird/pipes — debug boxes may keep DOM reads, gated behind `debugmode`), `?mjmute=1` mute.
4. Overlay: open game → ambient animations paused (inspect `animation-play-state`); Escape/close → resumed.
5. Real-device check (iPhone Safari + Android Chrome) before merge, per games device-matrix gate.

## Post-approval bookkeeping

- Write the design doc to `docs/superpowers/specs/2026-08-26-floppybird-mobile-perf-design.md` (content above) and commit, per brainstorming skill (deferred from plan mode).
