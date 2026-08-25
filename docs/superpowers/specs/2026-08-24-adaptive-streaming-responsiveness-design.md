# Adaptive streaming responsiveness — auto FLAC ⇄ 128k

Approved 2026-08-24 (brainstorming session). Scope: `script.js` store player IIFE only.

## Problem

`auto` mode demotes FLAC (`/s/`) to 128k mp3 (`/p/`) only after 4s of cumulative audible buffering; the single-element swap adds its own gap (src reload + seek); demotion is session-permanent, so a recovered connection never gets lossless back. Goal: demotion with no perceptible dead space, bounded slow starts, and a seamless, flap-proof return to lossless.

## Design

### 1. Dual audio elements (active-pointer refactor)

A second `<audio>` is created with `createElement` (CSP/Trusted Types safe) and appended beside `#store-audio`. `audio` becomes a mutable pointer to the active element, `standby` points at the other; `swapPointers()` exchanges them. All player listeners bind to both elements via a `bindBoth(type, fn)` helper whose wrapper guards `if (e.target !== audio) return;` — handler bodies keep referencing the `audio` pointer unchanged. `stop()` clears both elements. iOS/Safari unlock: on the first user-gesture play, the standby element runs a one-time muted `play()`→`pause()` so later programmatic handoff playback isn't blocked.

### 2. Gapless handoff (replaces `swapToMp3`)

`handoff(toPath, forcePlay)`: standby loads the same track from `toPath`; on its `canplay`, standby seeks to `audio.currentTime`, plays if the active was playing (or `forcePlay`), the active element is paused and released (`removeAttribute('src')` + `load()`), pointers swap, `currentPath`/quality label update. The active element keeps playing from its buffer during the standby load, so the switch is near-gapless. A generation token — bumped by `load()`, `stop()`, `step()`, and mode changes — cancels in-flight handoffs. Standby error falls through to the existing error path; the one-mp3-retry-per-load (`retried`) semantics stay.

### 3. Startup deadline

`START_DEADLINE = 2500` ms. When `load()` starts an autoplaying FLAC track in auto, a timer arms; cleared by `playing`, `stop()`, another `load()`, or a mode change. On fire: `recordDemote()` + `handoff('/p/', true)`.

### 4. Runway monitor + tighter backstop

On `timeupdate` while playing FLAC in auto: `runway` = buffered end ahead of playhead. Demote when runway < 3s AND shrinking vs the previous sample AND more than 5s of track remain AND the track isn't fully buffered. The reactive stall clock stays as backstop with `STALL_BUDGET` lowered 4000 → 2000 ms.

### 5. Re-promotion with hysteresis (replaces the `demoted` boolean)

State: `demoteCount`, `demotedAt`, `healthySince`, `promotable`. `streamPath()` auto branch: `(demoteCount > 0 && !promotable) || slowLink()` → `/p/`.

- Passive sampling (~5s cadence on `timeupdate`, demoted `/p/` playback in auto only): healthy = `!slowLink()` and (mp3 fully buffered or buffer growing ≥ realtime). An unhealthy sample resets the streak.
- Eligibility: healthy streak ≥ 20s AND cooldown elapsed — `min(60s × 2^(demoteCount−1), 8min)`.
- Confirm probe: one ranged GET `Range: bytes=0-524287` of the current FLAC source, wall-clocked; throughput ≥ 2 Mbps sets `promotable = true`. Failure restarts the cooldown clock. (API answers GET only; HEAD 404s.)
- Promotion applies at the next track boundary only — `load()` picks `/s/` naturally and resets `promotable`, keeping `demoteCount` so a re-stall backs off harder. Down fast, up slow; no flapping by construction.

### 6. Unchanged contracts

Manual `lossless` never auto-demotes; `saver` untouched; mode changes land on the next track. No inline script/style, no innerHTML; probe host already in `connect-src`, media host in `media-src`.

## BDD scenarios

```
Scenario: Runway demote is inaudible
  Given auto mode is streaming FLAC and the buffer runway shrinks below 3s
  When the monitor demotes to 128k
  Then playback continues without an audible gap and position is preserved

Scenario: Slow start falls back fast
  Given auto mode picked FLAC and 2.5s pass with no audio
  When the startup deadline fires
  Then the track starts on 128k and demoteCount increments

Scenario: Manual lossless is never touched
  Given the user forced lossless mode
  When the connection stalls
  Then no demotion occurs

Scenario: Recovered link returns to lossless at a boundary
  Given auto demoted to 128k, 20s of healthy playback, cooldown elapsed, probe ≥2 Mbps
  When the next track loads
  Then it streams FLAC and the playing track was never interrupted

Scenario: Flap resistance
  Given a promotion that stalls again
  When auto re-demotes
  Then the next cooldown doubles
```

## Verification

Manual, real browser (headless renders black). Local static server; Chrome DevTools custom throttling: slow start → 2.5s fallback; mid-track throttle drop → runway demote before audible stall, imperceptible swap; throttle removed → cooldown + streak + ranged probe → next track FLAC. Forced lossless never demotes. Regression: skip/scrub/stop/mode-cycle mid-handoff leave no orphan audio or double playback; console free of CSP violations. Post-deploy live re-check.
