# One player, signal-proof — unified `player.js` + offline vault

Approved 2026-09-04 (brainstorming session). Approach A: fetch-ahead + IndexedDB + blob playback. No Service Worker, no MSE.

## Problem

Two players exist: the adaptive store IIFE in `script.js` (home) and the trimmed `release.js` (release pages). Neither survives signal loss while driving. Chrome and WebKit `<audio>` deliberately cap buffer-ahead and never download a whole file, so when the link dies the buffer drains and the music stops. Matthew listens on iPhone Brave (a WebKit shell) with the phone backgrounded and the screen locked.

## Research findings (Sep 2026)

- web.dev / Workbox pattern: pre-fetch full media into storage and serve the element from it. Works in every engine.
- MSE rejected: iOS needs `ManagedMediaSource` + fragmented MP4; raw mp3/flac cannot be appended.
- Service Worker rejected as a dependency: third-party iOS browsers only got SW in iOS 14 with WKWebView caveats; it adds a versioned deploy artifact and fails invisibly. IndexedDB blobs + `blob:` URLs behave identically in Safari, Brave and Chrome on iOS.
- WebKit keeps the web process alive while audio plays and fires `ended`; the next `play()` must be synchronous inside that handler (WebKit bug 173332). Blob URLs for upcoming tracks are therefore prebuilt in memory, never awaited from IDB at a track boundary.
- WebKit storage: generous origin quota on iOS 17+, `navigator.storage.persist()` available; Safari-tab data is evicted after 7 idle days (home-screen installs exempt). A 128k mp3 is ≈4 MB/track.

## Decisions (Matthew)

- Vault 128k mp3 only. FLAC is stream-only (buy to own lossless).
- The release-page player must match the home player exactly.
- Tapping a card on `/` navigates to `/music/<slug>/`.
- `lossless` keeps its never-auto-demote contract from Aug 2026.

## Design

### 1. One module: `player.js`
Replaces the store IIFE in `script.js` and all of `release.js`. Loaded by `/` and every `/music/<slug>/`. Reads a `#store-data` JSON block (home: the full catalog; release page: the generator emits the same shape for that one release, unhashed — data blocks raise no CSP violation). Same DOM IDs on both pages. Full machine everywhere: scrubber, quality toggle, stop, dual-element gapless handoff, hysteresis, Media Session. Checkout delegation folds in. `script.js` keeps tabs, smooth scroll, pointer effects and the games overlay.

### 2. Bar parity by construction
`scripts/build.mjs` owns the bar markup (`playerBar()`) and rewrites `index.html` between `<!-- player:start -->` / `<!-- player:end -->` markers, the same mechanism as `notes:`. The test suite asserts the committed copy equals the generator's output and that the two hash-pinned JSON blocks are byte-identical before and after the rewrite. Release rows keep `.track-play[data-slug][data-track]`; `player.js` handles both `.store-play` (release, track 1) and `.track-play` (explicit NN).

### 3. Card tap navigates
CSS stretched-link on the existing `.store-title a` covers the card; play and buy buttons sit above it. No JS. On release pages a row tap plays, as today.

### 4. Vault (offline layer, inside `player.js`)
IndexedDB `mj-audio`, store `tracks`, key `slug/NN` → `{blob, bytes, at}`; `meta` store for LRU totals. Cap 200 MB, LRU eviction. `navigator.storage.persist()` requested once. On `load()`: vault the current mp3, then the next two tracks of the release, one `fetch(mode:'cors')` at a time, aborted by stop, release change or `offline`. In-memory map of prebuilt blob URLs for current + next two so `ended → src → play()` stays synchronous.

Source rules (`currentPath` gains `'vault'`):
- **auto**: healthy link → FLAC live, vault mp3 in the background as the handoff target. Runway/stall/error → `handoff(vault)` when present, else `/p/`. Offline, slow link or demoted → vault first, `/p/` only if not vaulted.
- **saver**: vault first, always.
- **lossless**: unchanged; never demotes. Still vaults mp3 quietly so the next track can survive.
- Blob sources are exempt from the stall/runway monitors and from the FLAC probe while offline.
- Offline = `navigator.onLine === false`, `offline`/`online` events, or a vault fetch `TypeError`. Offline and not vaulted → status line "no signal, and this one isn't saved yet." and playback stops at that boundary; `online` resumes the queue.

### 5. Resume across pages
`localStorage mj-player-state = {slug, index, t, v:1}`, written on `timeupdate` (≥2 s apart), `pause` and `pagehide`. Any page whose catalog has the slug boots the bar paused at that position; one tap resumes (iOS blocks autoplay in a fresh document). Cleared by stop and by `ended` on the last track.

### 6. Worker
`/p/` gets `streamCorsHeaders` and an `OPTIONS` route — same single-origin allowlist as `/s/`; cached entries stay origin-neutral.

### 7. CSP
`media-src` adds `blob:`. No new hosts, no Service Worker, no inline anything, no `innerHTML`.

### 8. Tests
`scripts/build.test.mjs`: bar parity, per-release `#store-data` matches `data/releases.json`, release pages load `player.js`, no globals or innerHTML, hashes unmoved. Worker vitest: `/p/` ACAO for the site origin only, `OPTIONS` 204. `scripts/player.test.mjs`: evaluates the IIFE under a stub DOM (`node:vm`) and asserts the source-resolution table, LRU eviction and the synchronous `ended → src` rule.

## BDD scenarios

```
Story: Signal drops mid-track
  In order to keep listening through a dead zone,
  a listener in auto mode wants playback to survive the network going away.

  Scenario: Gapless fall-through to the vault
    Given auto mode is streaming FLAC and the same track's mp3 is vaulted
    When the network goes offline
    Then playback continues from the vaulted mp3 with no audible gap and position kept

  Scenario: Nothing saved yet
    Given a track that is not vaulted
    When the network is offline at its boundary
    Then the player stops with the "no signal" line and retries nothing

Story: Album survives a dead zone
  In order to hear the whole record while driving,
  a listener wants the next tracks ready before the signal is gone.

  Scenario: Next track from the vault, screen locked
    Given a release playing with the next two tracks vaulted
    When the track ends while offline with the screen locked
    Then the next track starts from the vault without a tap

  Scenario: Back online
    Given the vault queue was paused by offline
    When the network returns
    Then the queue resumes with the next unvaulted track

Story: One player, two pages
  In order to browse without losing my place,
  a listener wants the release page to pick up where the home page left off.

  Scenario: Resume on the release page
    Given a track playing on /
    When I tap its card and land on /music/<slug>/
    Then the bar shows that track paused at the same position and one tap resumes

  Scenario: Identical bar
    Given the home bar has a scrubber, quality toggle and stop
    When a release page renders its bar
    Then it carries the same controls with the same ids
```

## Verification

Automated: `node --test scripts/` and `cd worker && npx vitest run` green; `node scripts/build.mjs --out <tmp>` and diff the `index.html` player block against the generated bar; the two `_headers` hashes unchanged.

Real browser (headless renders black — Chrome desktop and iPhone Brave against the live deploy):
1. Home, tap play (auto): FLAC starts; one `/p/` fetch completes behind it; IDB holds `slug/01`, then `02`, `03`.
2. DevTools Offline mid-track: no audible gap, label flips to `128k`, position continues; track ends offline → next track from the vault.
3. Unvaulted third track offline → status line, no error loop; back online → fetching resumes, tap plays.
4. Slow 3G from cold: start deadline fires → vault or `/p/`; no double audio; scrub/skip/stop mid-handoff leave one playing element.
5. iPhone Brave: play an album, lock the screen, airplane mode on → at least the next two tracks play; lock-screen controls work; no CSP violations.
6. Card tap on `/` → `/music/<slug>/` shows the track paused at position; one tap resumes. Reverse direction too.
7. Release bar structurally identical to home; axe 100; 44px targets.
8. Lighthouse home performance ≥ 98.
