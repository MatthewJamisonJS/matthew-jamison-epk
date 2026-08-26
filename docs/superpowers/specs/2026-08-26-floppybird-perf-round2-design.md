# Floppybird mobile perf — round 2 design

Date: 2026-08-26 · Branch: `games-floppybird-perf2` · Status: approved by Matthew (plan-mode approval, same content)

## Context

The round-1 rewrite (rAF fixed-timestep, math collision, transform-only rendering — merged `a0baf73`) improved mobile but real-device play still shows **constant stutter and periodic hitches**. The game loop is already clean (zero DOM reads per frame in `games/floppybird/js/main.js`). The remaining hot-path costs, identified by source read:

1. **Audio.** buzz calls `stop()` + `play()` on an HTMLMediaElement per flap (`playerJump`, main.js:351), per score, and at death. Seeking and playing media elements is main-thread expensive on mobile. Matches the *constant* stutter — the player taps constantly.
2. **Score DOM churn.** `setBigScore` (main.js:359) empties and re-appends `<img>` nodes on every point → image decode + layout. Matches the *periodic* hitch.
3. **Pipe spawn allocation.** A new DOM subtree with a `will-change: transform` layer is created every 1400ms (`updatePipes`, main.js:535) and destroyed offscreen. Layer alloc/free churn — also periodic.
4. **First-use image decodes** (scoreboard, medals, digit fonts) hitch state transitions.

Scope decision: surgical hot-path pass on floppybird only; the other three games (2048, tiny-platformer, sandspiel) get an **audit-only report** this round.

## Changes (all in `games/floppybird/`)

### 1. Web Audio sound engine (replaces buzz on all paths)
- Fetch + `decodeAudioData` the 5 sfx once at boot; playback = `AudioBufferSourceNode` through a shared `GainNode` at 0.3 (parity with buzz volume 30).
- Format pick: ogg first, m4a for browsers whose `decodeAudioData` lacks ogg (iOS/Safari). Detect before fetch: `new Audio().canPlayType('audio/ogg; codecs="vorbis"')` — empty string → fetch m4a.
- `AudioContext` is created at boot (it decodes while suspended), resumed on the first user gesture — the existing touchstart/mousedown handler (main.js:334).
- Death chain parity: desktop plays hit → die → `showScore()` via `onended`; mobile (`isIncompatible.any()`) skips straight to `showScore()` (main.js:442-456). Preserve exactly.
- Remove the buzz `<script>` tag from `index.html` once nothing references it.
- **Mute contract holds without change:** `games/mj-mute.js:64-88` already zero-gains every AudioContext's destination under `?mjmute=1`. mj-mute loads first, so the game's context is constructed through the shadowed constructor.
- CSP: same-origin script only; per-slug `_headers` `script-src 'self'` unaffected (confirm during review).

### 2. Score render without churn
- Preload big + small digit images (0–9) at boot.
- Reuse the `<img>` children of `#bigscore` / `#currentscore` / `#highscore`: update `src`, add/hide nodes only when the digit count changes. No `empty()` + `append()` per point.

### 3. Pipe pooling
- Pipes released offscreen (`rendergame`, main.js:299) or swept at `showSplash` (`$(".pipe").remove()`) go into a pool instead of being destroyed. `updatePipes` reuses: reset child heights + transform, re-append. Pool cap ~4.

### 4. Boot-time image warm-up
- `new Image()` warm for scoreboard, splash, medals, replay — removes first-use decode hitches at state transitions.

### 5. `?debug` perf HUD
- Only when `debugmode` is true: a fixed-position div updated via `textContent` every ~500ms — fps, worst frame ms (rolling 5s), long-frame count (>33ms). No layout reads, no innerHTML (Trusted Types). Zero nodes and zero listeners without `?debug`. Production DOM identical to today.

## BDD scenarios

Story: smooth play on a phone
In order to play without stutter, a visitor on a mid-range phone wants every tap and score to land on the next frame.

- Given the game on a real phone with `?debug`, When tapping continuously through 60s of play, Then the long-frame count stays under ~5% of frames and no hitch coincides with the jump sfx.
- Given a scoring run, When the bird passes a pipe, Then the score updates with no image decode or layout-driven long frame.
- Given `?mjmute=1`, When sfx events fire during play, Then no audible output (Web Audio destination is zero-gained by the shim).
- Given no `?debug`, When playing in production, Then no HUD elements exist in the DOM.

Story: behavior parity
In order to keep the game identical in feel and rules, the owner wants round-2 changes invisible except for smoothness.

- Given the death chain on desktop, When the bird dies, Then hit → die sounds play sequentially and the scoreboard appears after, exactly as before.
- Given pipe pooling, When pipes recycle, Then spawn cadence, gap math, and collision numbers are byte-identical to current main (re-run the round-1 Node stub harness).

## Other-games perf audit (report only)

Read the loop/render/input paths of `games/2048`, `games/tiny-platformer`, `games/sandspiel` (sandspiel: wasm + regl — check devicePixelRatio handling, canvas sizing, rAF behavior; note upstream quirks, do not patch wasm). Deliverable: `docs/superpowers/specs/2026-08-26-games-perf-audit.md`, findings ranked by expected mobile impact with file:line evidence and a proposed fix each, for a later round.

## Verification

1. Node stub harness: death/score timing parity vs current main.
2. Preview deploy (`wrangler pages deploy` on this branch) → Matthew plays with `?debug` on iPhone Safari + Android Chrome; gate = HUD long frames <5% + feel.
3. `?mjmute=1` silence check; production URL shows no HUD.
4. **Merge only after the device pass** — round 1 merged before it; not this time.

## Execution workflow

Fable authors spec + implementation plan → Opus subagent implements one task at a time → Fable reviews each diff (spec parity, CSP/Trusted Types, mute contract) and tightens the next instruction → loop until gates pass. Implementers STOP on 1Password sign errors — never `--no-gpg-sign`.
