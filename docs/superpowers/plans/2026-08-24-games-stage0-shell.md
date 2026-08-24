# Games Section — Stage 0 (Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/games` shell on matthewjamison.dev — nav link, games section with grid, fullscreen overlay lifecycle, keep-listening music modal, mute shim, per-path headers — fully working against a test page, before any real game is vendored.

**Architecture:** Vanilla HTML/CSS/JS, no build step. Games module is a new IIFE appended to `script.js` (runs under the site's strict CSP: Trusted Types enforced, so `createElement`/`textContent` only, never `innerHTML`). Overlay + dialog markup is static in `index.html` (hidden until used); only the `<iframe>` is created/destroyed dynamically. Game routes get their own least-privilege CSP via `_headers` per-path rules. Spec: `docs/superpowers/specs/2026-08-24-games-section-design.md`.

**Tech Stack:** Plain DOM APIs, `<dialog>` element, Fullscreen API + CSS `100dvh` fallback, Cloudflare Pages `_headers`.

**Executor notes (read first):**
- This repo has **no test framework** and must stay build-free. The BDD outer loop runs as browser acceptance checks against a local static server; each task states the exact check and expected observation. Use the superpowers-chrome `use_browser` tool.
- **Footgun:** headless-Chrome *screenshots* of this page render black. Verify via DOM queries / JS evaluation in the browser tool, never via screenshot pixels.
- **Footgun:** `_headers` is edge-only. A local server serves no CSP — local runs verify *behavior*, the deployed site verifies *headers*.
- Copy rules: site aesthetic lowercase; section labels are `<h2 class="section-label comment">` with `// ` prefix; user-facing copy below is placeholder and will be replaced via content-workshop — do not "improve" it.
- Git: NEVER add AI co-author attribution. One logical change per commit.
- Local server for checks: `python3 -m http.server 8080` from repo root (run in background), pages at `http://localhost:8080/`.

---

### Task 1: Verify `_headers` detach syntax, add game-route header rules

**Files:**
- Modify: `_headers` (append at end)

- [ ] **Step 0: Story**

```
In order to let vendored games run without weakening the site's strict CSP,
the site owner wants game routes to carry their own least-privilege headers.
```

- [ ] **Step 1: Confirm Cloudflare Pages supports header detach (`! Header-Name`)**

Use the `mcp__cf-docs__search_cloudflare_documentation` tool with query: `Pages _headers file detach remove header "!" syntax`. Expected: the Headers docs state a header can be removed for a path by prefixing its name with `!` (e.g. `! Access-Control-Allow-Origin`). If the docs do NOT confirm this, STOP and flag at the review checkpoint — the fallback design (narrowing the `/*` CSP rule to explicit non-game paths) is a Fable decision, not an executor improvisation.

- [ ] **Step 2: Append game-route rules to `_headers`**

Append exactly this block to the end of `_headers`:

```
# ── games routes ─────────────────────────────────────────────────────────
# Vendored third-party games are framed by index.html only. The site-wide
# strict CSP + X-Frame-Options: DENY are detached per game route; each slug
# carries its own least-privilege policy derived from its vendor-time audit
# (see docs/superpowers/specs/2026-08-24-games-section-design.md §4a).
# Trusted Types are deliberately NOT enforced here — the games use innerHTML
# internally; exfiltration is capped by connect-src/form-action instead.

# _test is the Stage 0 lifecycle test page (kept deployed: it is the
# reference harness for the overlay contract).
/games/_test/*
  ! X-Frame-Options
  ! Content-Security-Policy
  X-Frame-Options: SAMEORIGIN
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; media-src data:; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'
```

- [ ] **Step 3: Sanity-check the file parses as intended**

Run: `grep -n "games/_test" _headers`
Expected: one match inside the new block; no duplicate path rules elsewhere.

- [ ] **Step 4: Commit**

```bash
git add _headers
git commit -m "add: per-route headers for games test page; detach strict CSP on game routes"
```

---

### Task 2: index.html — viewport, nav link, games section, overlay + dialog markup

**Files:**
- Modify: `index.html` (four spots: viewport meta line 5, nav ~line 101, new section after `</section>` of watch ~line 810, overlay/dialog before `</body>`)

- [ ] **Step 0: Story**

```
In order to discover and play free games without leaving the EPK,
a visitor wants a games section reachable from the main nav.
```

- [ ] **Step 1: Failing acceptance scenario (outer loop)**

```gherkin
Feature: Games section shell
  Scenario: Nav reaches the games section
    Given the EPK page is loaded
    When the visitor clicks "Games" in the nav
    Then the page scrolls to a "// games" section containing a tile grid
```

Verify it fails: open `http://localhost:8080/` in the browser tool, evaluate `!!document.getElementById('games')`. Expected: `false`.

- [ ] **Step 2: Update the viewport meta (line 5)**

Replace:
```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
```
with:
```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```
(`env(safe-area-inset-*)` in the overlay CSS needs `viewport-fit=cover`.)

- [ ] **Step 3: Add the nav link**

In the `<nav class="nav">` block, insert after the Watch line (`<a href="#watch">Watch</a>`):
```html
    <a href="#games">Games</a>
```

- [ ] **Step 4: Insert the games section**

Between the watch section's closing `</section>` and the `<!-- services -->` comment, insert:

```html
    <!-- games -->
    <section id="games" class="section" aria-label="games — free in-browser games">
      <h2 class="section-label comment">// games &nbsp;·&nbsp; free &nbsp;·&nbsp; in-browser</h2>

      <div class="games-grid" id="games-grid">
        <div class="game-tile">
          <button
            type="button"
            class="game-tile-btn"
            data-slug="_test"
            data-name="overlay test"
            data-author="matthew jamison"
            data-repo="https://github.com/MatthewJamisonJS"
          >
            <span class="game-tile-art" aria-hidden="true"></span>
            <span class="game-tile-name">overlay test</span>
          </button>
          <p class="game-tile-credit">game by <a href="https://github.com/MatthewJamisonJS" target="_blank" rel="noopener">matthew jamison</a></p>
        </div>
      </div>
    </section>
```

(One placeholder tile in Stage 0; Stage 1 replaces it with real game tiles + `assets/games/{slug}-thumb.webp` images. `.game-tile-art` is a CSS gradient placeholder — no image asset needed yet.)

- [ ] **Step 5: Insert overlay + music dialog markup before `</body>`'s script tag**

Immediately before the existing `<script src="script.js` line, insert:

```html
  <!-- game overlay: static shell, iframe created on demand (Trusted Types — no innerHTML) -->
  <div id="game-overlay" class="game-overlay" role="dialog" aria-modal="true" aria-label="game" hidden>
    <div class="game-overlay-chrome">
      <p class="game-overlay-title"><span id="game-overlay-name"></span> <span class="muted" id="game-overlay-credit"></span></p>
      <button type="button" id="game-close" class="game-close" aria-label="close game">✕</button>
    </div>
    <div id="game-frame-host" class="game-frame-host"></div>
    <div id="game-error" class="game-error" hidden>
      <p class="muted">the game didn't load.</p>
      <div class="game-error-actions">
        <button type="button" id="game-retry" class="btn">→ retry</button>
        <button type="button" id="game-error-close" class="btn-ghost">→ back to the page</button>
      </div>
    </div>
  </div>

  <dialog id="game-music-dialog" class="game-music-dialog" aria-labelledby="game-music-q">
    <p id="game-music-q" class="comment">// keep listening?</p>
    <p class="game-music-note muted">keep your track playing and the game runs silent — or pause it and hear the game.</p>
    <div class="game-music-actions">
      <button type="button" id="game-music-keep" class="btn">→ keep my music</button>
      <button type="button" id="game-music-game" class="btn-ghost">→ game audio</button>
    </div>
  </dialog>
```

- [ ] **Step 6: Verify structure**

Run: `grep -c "game-overlay\|game-music-dialog\|href=\"#games\"" index.html`
Expected: ≥ 6. Then reload `http://localhost:8080/` in the browser tool and evaluate:
`[!!document.getElementById('games'), !!document.getElementById('game-overlay'), document.getElementById('game-overlay').hidden]`
Expected: `[true, true, true]`. (Unstyled is fine — Task 3 styles it.)

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "add: games section shell, nav link, overlay + music dialog markup"
```

---

### Task 3: style.css — grid, tiles, overlay, dialog, scroll lock

**Files:**
- Modify: `style.css` (append one block at end)

- [ ] **Step 0: Story**

```
In order to browse games comfortably on any device,
a visitor wants a 2-column tile grid and a fullscreen game surface that
respects notches and never scrolls the page underneath.
```

- [ ] **Step 1: Failing check**

Browser tool on `http://localhost:8080/`: evaluate `getComputedStyle(document.querySelector('.games-grid')).display`. Expected: NOT `grid` yet (block).

- [ ] **Step 2: Append styles**

Append to the end of `style.css`:

```css
/* ── games ─────────────────────────────────────── */
.games-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 18px;
}
@media (max-width: 560px) {
  .games-grid { grid-template-columns: 1fr; }
}

.game-tile-btn {
  display: block;
  width: 100%;
  padding: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  cursor: pointer;
  font-family: var(--mj-font);
  color: var(--text);
  text-align: left;
  transition: border-color 0.15s;
}
.game-tile-btn:hover,
.game-tile-btn:focus-visible { border-color: var(--mj-accent-border); }

/* stage-0 placeholder art — replaced by <img> thumbnails when games land */
.game-tile-art {
  display: block;
  aspect-ratio: 16 / 10;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(139, 31, 168, 0.28), transparent 60%),
    radial-gradient(ellipse at 75% 80%, rgba(91, 163, 108, 0.14), transparent 55%),
    var(--surface-2);
}

.game-tile-name {
  display: block;
  padding: 12px 14px;
  font-size: 12px;
  letter-spacing: 0.04em;
}

.game-tile-credit {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-muted);
}
.game-tile-credit a { text-decoration: underline; }

/* while a game is open the page underneath must not scroll or rubber-band */
body.game-locked {
  overflow: hidden;
  overscroll-behavior: none;
}

/* ── game overlay ── */
.game-overlay {
  position: fixed;
  inset: 0;
  height: 100vh;   /* fallback first */
  height: 100dvh;  /* tracks mobile browser chrome show/hide */
  z-index: 9999;
  background: #000;
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
           env(safe-area-inset-bottom) env(safe-area-inset-left);
  display: flex;
  flex-direction: column;
}
.game-overlay[hidden] { display: none; }

.game-overlay-chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 6px 6px 14px;
}
.game-overlay-title {
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.game-close {
  flex: none;
  width: 44px;   /* WCAG target size */
  height: 44px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.game-close:hover,
.game-close:focus-visible { border-color: var(--mj-accent-bright); color: var(--mj-accent-bright); }

.game-frame-host { flex: 1; min-height: 0; }
.game-frame-host iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

.game-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: #000;
}
.game-error[hidden] { display: none; }
.game-error-actions { display: flex; gap: 12px; }

/* ── keep-listening dialog ── */
.game-music-dialog {
  background: var(--plate);
  border: 1px solid var(--plate-edge);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--mj-font);
  padding: 22px;
  max-width: 340px;
}
.game-music-dialog::backdrop { background: rgba(0, 0, 0, 0.6); }
.game-music-note { margin: 10px 0 16px; font-size: 12px; }
.game-music-actions { display: flex; gap: 12px; flex-wrap: wrap; }
```

- [ ] **Step 3: Verify**

Browser tool, reload, evaluate:
`[getComputedStyle(document.querySelector('.games-grid')).display, getComputedStyle(document.getElementById('game-overlay')).display]`
Expected: `["grid", "none"]`.

- [ ] **Step 4: Commit**

```bash
git add style.css
git commit -m "add: games grid, overlay, and keep-listening dialog styles"
```

---

### Task 4: `games/mj-mute.js` — the mute shim

**Files:**
- Create: `games/mj-mute.js` (canonical copy; each vendored game gets a copy in its own folder in later stages so game folders stay self-contained)

- [ ] **Step 0: Story**

```
In order to keep listening to a catalog track while playing,
a visitor wants the game to run fully silent when they chose their music.
```

- [ ] **Step 1: Write the shim**

Create `games/mj-mute.js`:

```js
/* mj-mute.js — vendored as the FIRST script in each game's index.html.
   Inert unless the page URL carries ?mjmute=1 (appended by the parent EPK
   page when the visitor chose to keep their catalog music playing).
   Must run before any game code: it silences both audio paths a game can
   take — HTMLMediaElement and Web Audio — before either is first used. */
(function () {
  'use strict';
  if (!/[?&]mjmute=1(?:&|$)/.test(window.location.search)) return;

  /* media elements: force the ENGINE's muted flag through the native
     setters (shadowing the getter alone would only lie to JS while audio
     kept playing). Reads are pinned; writes are redirected to muted=true,
     volume=0 via the captured native descriptors. */
  var proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (proto) {
    var origPlay = proto.play;
    var mutedDesc = Object.getOwnPropertyDescriptor(proto, 'muted');
    var volumeDesc = Object.getOwnPropertyDescriptor(proto, 'volume');
    function forceMute(el) {
      try {
        if (mutedDesc && mutedDesc.set) mutedDesc.set.call(el, true);
        if (volumeDesc && volumeDesc.set) volumeDesc.set.call(el, 0);
      } catch (e) { /* detached or foreign element */ }
    }
    proto.play = function () {
      forceMute(this);
      return origPlay.apply(this, arguments);
    };
    try {
      Object.defineProperty(proto, 'muted', {
        configurable: true,
        get: function () { return true; },
        set: function () { forceMute(this); }
      });
      Object.defineProperty(proto, 'volume', {
        configurable: true,
        get: function () { return 0; },
        set: function () { forceMute(this); }
      });
    } catch (e) { /* accessors locked — the play() patch still mutes */ }

    /* <audio autoplay> in markup never calls play() from JS — sweep the
       document once it exists, and watch for elements added later */
    function sweep(root) {
      var list = root.querySelectorAll ? root.querySelectorAll('audio, video') : [];
      for (var i = 0; i < list.length; i++) forceMute(list[i]);
    }
    document.addEventListener('DOMContentLoaded', function () {
      sweep(document);
      new MutationObserver(function (muts) {
        for (var m = 0; m < muts.length; m++) {
          var added = muts[m].addedNodes;
          for (var n = 0; n < added.length; n++) {
            var node = added[n];
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'AUDIO' || node.tagName === 'VIDEO') forceMute(node);
            else sweep(node);
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  /* Web Audio: every context's destination becomes a zero-gain proxy, so
     whatever the game connects to "ctx.destination" is silenced. The real
     destination is wired up before the getter is shadowed. */
  function silenced(Ctor) {
    if (typeof Ctor !== 'function') return Ctor;
    function MutedCtx() {
      var ctx = arguments.length
        ? new Ctor(arguments[0])
        : new Ctor();
      var mute = ctx.createGain();
      mute.gain.value = 0;
      mute.connect(ctx.destination);
      try {
        Object.defineProperty(ctx, 'destination', {
          configurable: true,
          get: function () { return mute; }
        });
      } catch (e) { /* non-configurable — media-element pinning still holds */ }
      return ctx;
    }
    MutedCtx.prototype = Ctor.prototype;
    return MutedCtx;
  }
  window.AudioContext = silenced(window.AudioContext);
  window.webkitAudioContext = silenced(window.webkitAudioContext);
})();
```

- [ ] **Step 2: Syntax check**

Run: `node --check games/mj-mute.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add games/mj-mute.js
git commit -m "add: mj-mute.js game audio shim (?mjmute=1 silences media + web audio)"
```

(Behavioral verification happens in Task 5 Step 4 and Task 7 — the shim needs the test page to prove itself.)

---

### Task 5: `games/_test/` — lifecycle test page

**Files:**
- Create: `games/_test/index.html`
- Create: `games/_test/test.css`
- Create: `games/_test/test.js`

- [ ] **Step 0: Story**

```
In order to prove the overlay contract before any real game is vendored,
the developer wants a test page that exercises keyboard focus, touch input,
media-element audio, and Web Audio.
```

- [ ] **Step 1: Create `games/_test/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>overlay test page</title>
  <link rel="stylesheet" href="test.css">
  <script src="../mj-mute.js"></script>
</head>
<body>
  <h1>overlay test</h1>
  <p id="focus-state">focus: <span id="focus-value">unknown</span></p>
  <p id="key-state">last key: <span id="key-value">none yet</span></p>
  <p id="tap-state">taps: <span id="tap-value">0</span></p>
  <p id="audio-state">audio: <span id="audio-value">idle</span></p>
  <button type="button" id="tone-btn">play web-audio tone</button>
  <button type="button" id="media-btn">play media-element tone</button>
  <script src="test.js"></script>
</body>
</html>
```

(`mj-mute.js` loads first, synchronously, exactly as it will in vendored games. Same-folder-relative `../mj-mute.js` is Stage-0-only; vendored games copy the shim into their own folder.)

- [ ] **Step 2: Create `games/_test/test.css`**

```css
body {
  margin: 0;
  padding: 24px;
  background: #111;
  color: #e8e8e8;
  font-family: monospace;
  font-size: 14px;
  line-height: 1.7;
}
button {
  display: block;
  margin-top: 12px;
  padding: 10px 18px;
  font-family: inherit;
  cursor: pointer;
}
```

- [ ] **Step 3: Create `games/_test/test.js`**

```js
/* Exercises everything the overlay contract cares about:
   - window focus (keyboard games need it immediately)
   - keydown delivery (proves iframe focus, and gives Escape a live target)
   - pointer taps (touch pass-through)
   - both audio paths, with an on-page readout of whether they are muted */
(function () {
  'use strict';
  var focusValue = document.getElementById('focus-value');
  var keyValue = document.getElementById('key-value');
  var tapValue = document.getElementById('tap-value');
  var audioValue = document.getElementById('audio-value');
  var taps = 0;

  function paintFocus() {
    focusValue.textContent = document.hasFocus() ? 'yes' : 'no';
  }
  window.addEventListener('focus', paintFocus);
  window.addEventListener('blur', paintFocus);
  paintFocus();

  document.addEventListener('keydown', function (e) {
    keyValue.textContent = e.key;
  });

  document.addEventListener('pointerdown', function () {
    taps += 1;
    tapValue.textContent = String(taps);
  });

  document.getElementById('tone-btn').addEventListener('click', function () {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = new Ctx();
    var osc = ctx.createOscillator();
    osc.frequency.value = 440;
    osc.connect(ctx.destination);
    osc.start();
    setTimeout(function () { osc.stop(); ctx.close(); }, 800);
    /* the shim shadows ctx.destination with a zero-gain node; report it */
    var muted = !!(ctx.destination && ctx.destination.gain && ctx.destination.gain.value === 0);
    audioValue.textContent = muted ? 'web-audio MUTED' : 'web-audio audible';
  });

  document.getElementById('media-btn').addEventListener('click', function () {
    /* 0.5s of silence-shaped wav is enough to observe the muted property */
    var a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=');
    var p = a.play();
    if (p && p.catch) { p.catch(function () { /* autoplay policy — fine */ }); }
    audioValue.textContent = a.muted ? 'media MUTED' : 'media audible (muted=' + a.muted + ', volume=' + a.volume + ')';
  });
})();
```

- [ ] **Step 4: Verify the shim + test page directly (inner loop for Task 4 and 5)**

Browser tool:
1. Open `http://localhost:8080/games/_test/index.html` → click "play web-audio tone" → page must read `web-audio audible`; click "play media-element tone" → `media audible (muted=false, volume=1)`.
2. Open `http://localhost:8080/games/_test/index.html?mjmute=1` → same two clicks → must read `web-audio MUTED` and `media MUTED`.
3. Press any letter key → "last key" updates.

Expected: all three observations exactly as stated. If (2) fails, the shim is wrong — fix `games/mj-mute.js`, not the test page.

- [ ] **Step 5: Commit**

```bash
git add games/_test/
git commit -m "add: overlay-contract test page (focus, keys, taps, both audio paths)"
```

---

### Task 6: script.js — games module (overlay lifecycle + music modal)

**Files:**
- Modify: `script.js` (append one IIFE at end)

- [ ] **Step 0: Story**

```
In order to play instantly and leave cleanly,
a visitor wants a game to open fullscreen on click and to close via X,
Escape, or the back button, landing exactly where they left the page —
and to be offered "keep listening?" whenever their music is playing.
```

- [ ] **Step 1: Failing acceptance scenarios (outer loop)**

```gherkin
Feature: Game overlay lifecycle
  Scenario: Open and close restores position
    Given the visitor has scrolled to the games section
    When they click a game tile and then the close button
    Then the game opened fullscreen and they are back at the same scroll position
      And the iframe is gone from the DOM

  Scenario: Music choice
    Given a catalog track is playing
    When the visitor clicks a game tile
    Then a dialog offers "keep my music" or "game audio"
      And "keep my music" opens the game with ?mjmute=1 while the track keeps playing
      And "game audio" pauses the track and opens the game unmuted

  Scenario: One overlay ever
    Given the visitor double-clicks a tile rapidly
    Then exactly one overlay and one iframe exist
```

Verify failing: browser tool on `http://localhost:8080/`, click the test tile (`document.querySelector('.game-tile-btn').click()`), evaluate `document.getElementById('game-overlay').hidden`. Expected: still `true` (no module yet).

- [ ] **Step 2: Append the games module to `script.js`**

```js
// games: click-to-play fullscreen overlay. Static shell lives in index.html;
// only the iframe is created/destroyed here (createElement — the CSP requires
// Trusted Types, innerHTML is not available). One overlay instance ever;
// open/close are idempotent. Native fullscreen is attempted on top of the
// overlay, and the overlay is the source of truth either way, so the close
// chrome is identical whether the API worked (desktop/Android/iPadOS) or
// not (iPhone Safari has no element fullscreen).
(function () {
  const grid = document.getElementById('games-grid');
  const overlay = document.getElementById('game-overlay');
  const frameHost = document.getElementById('game-frame-host');
  const closeBtn = document.getElementById('game-close');
  const nameEl = document.getElementById('game-overlay-name');
  const creditEl = document.getElementById('game-overlay-credit');
  const errorEl = document.getElementById('game-error');
  const retryBtn = document.getElementById('game-retry');
  const errorCloseBtn = document.getElementById('game-error-close');
  const musicDialog = document.getElementById('game-music-dialog');
  const keepBtn = document.getElementById('game-music-keep');
  const gameAudioBtn = document.getElementById('game-music-game');
  const storeAudio = document.getElementById('store-audio');
  if (!grid || !overlay || !frameHost || !closeBtn) return;

  const LOAD_BUDGET = 10000;  // ms before the plain retry/close state shows

  let open = null;      // { tile, slug, muted, scrollY } while open
  let loadTimer = 0;
  let pendingTile = null;  // tile awaiting the music dialog's answer

  function musicPlaying() {
    return !!(storeAudio && storeAudio.currentSrc && !storeAudio.paused);
  }

  function setInertBackground(on) {
    // everything except the overlay is inert while a game is open, so
    // screen readers and tab order can't wander under the game
    document.querySelectorAll('body > :not(#game-overlay)').forEach(el => {
      if (on) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    });
  }

  function showError() {
    clearTimeout(loadTimer);
    loadTimer = 0;
    errorEl.hidden = false;
  }

  function buildFrame() {
    const iframe = document.createElement('iframe');
    iframe.src = '/games/' + open.slug + '/index.html' + (open.muted ? '?mjmute=1' : '');
    iframe.title = open.tile.dataset.name;
    // same-origin documentation only — not a security boundary here
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock');
    iframe.addEventListener('load', () => {
      clearTimeout(loadTimer);
      loadTimer = 0;
      errorEl.hidden = true;
      try {
        iframe.contentWindow.focus();
        // Escape inside the game must still close the overlay; keydown in
        // the iframe never bubbles to the parent, so listen there directly
        iframe.contentDocument.addEventListener('keydown', e => {
          if (e.key === 'Escape') closeGame(false);
        });
      } catch (e) { /* frame gone mid-load */ }
    });
    return iframe;
  }

  function mountFrame() {
    while (frameHost.firstChild) frameHost.removeChild(frameHost.firstChild);
    errorEl.hidden = true;
    clearTimeout(loadTimer);
    loadTimer = setTimeout(showError, LOAD_BUDGET);
    frameHost.appendChild(buildFrame());
  }

  function openGame(tile, muted) {
    if (open) return;   // idempotent: double-click can't stack overlays
    open = {
      tile: tile,
      slug: tile.dataset.slug,
      muted: muted,
      scrollY: window.scrollY
    };
    nameEl.textContent = tile.dataset.name;
    creditEl.textContent = ' ·  game by ' + tile.dataset.author;
    overlay.setAttribute('aria-label', tile.dataset.name);
    document.body.classList.add('game-locked');
    setInertBackground(true);
    history.pushState({ mjGame: open.slug }, '');
    overlay.hidden = false;
    mountFrame();
    if (overlay.requestFullscreen) {
      overlay.requestFullscreen().catch(() => { /* iPhone: overlay IS fullscreen */ });
    }
  }

  function closeGame(fromPopstate) {
    if (!open) return;  // idempotent: Escape + fullscreenchange can both fire
    const closed = open;
    open = null;
    clearTimeout(loadTimer);
    loadTimer = 0;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { /* already leaving */ });
    }
    while (frameHost.firstChild) frameHost.removeChild(frameHost.firstChild);
    errorEl.hidden = true;
    overlay.hidden = true;
    setInertBackground(false);
    document.body.classList.remove('game-locked');
    window.scrollTo(0, closed.scrollY);
    closed.tile.focus();
    if (!fromPopstate && history.state && history.state.mjGame) {
      history.back();   // pops our entry; the popstate handler is a no-op now
    }
  }

  grid.addEventListener('click', e => {
    const tile = e.target.closest('.game-tile-btn');
    if (!tile || open) return;
    if (musicPlaying() && musicDialog && musicDialog.showModal) {
      pendingTile = tile;
      musicDialog.showModal();
      return;
    }
    openGame(tile, false);
  });

  if (keepBtn) keepBtn.addEventListener('click', () => {
    musicDialog.close();
    if (pendingTile) { openGame(pendingTile, true); pendingTile = null; }
  });
  if (gameAudioBtn) gameAudioBtn.addEventListener('click', () => {
    if (storeAudio) storeAudio.pause();
    musicDialog.close();
    if (pendingTile) { openGame(pendingTile, false); pendingTile = null; }
  });
  if (musicDialog) musicDialog.addEventListener('cancel', () => { pendingTile = null; });

  closeBtn.addEventListener('click', () => closeGame(false));
  if (errorCloseBtn) errorCloseBtn.addEventListener('click', () => closeGame(false));
  if (retryBtn) retryBtn.addEventListener('click', () => { if (open) mountFrame(); });

  // Escape on the parent (close button focused, or CSS-overlay path on iPhone)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open) closeGame(false);
  });

  // user exits native fullscreen (browser Esc / gesture) → same close path,
  // never a stranded headerless overlay
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && open) closeGame(false);
  });

  // back button closes the overlay instead of leaving the page
  window.addEventListener('popstate', () => {
    if (open) closeGame(true);
  });

  // clicking overlay chrome hands focus back to the game
  overlay.addEventListener('pointerdown', e => {
    if (e.target === closeBtn || errorEl.contains(e.target)) return;
    const iframe = frameHost.querySelector('iframe');
    if (iframe) { try { iframe.contentWindow.focus(); } catch (err) { /* gone */ } }
  });
})();
```

- [ ] **Step 3: Syntax check**

Run: `node --check script.js`
Expected: exit 0.

- [ ] **Step 4: Acceptance pass (outer loop closes)**

Browser tool on `http://localhost:8080/` (evaluate JS; do not rely on screenshots):

1. `document.querySelector('.game-tile-btn').click()` → then evaluate `[document.getElementById('game-overlay').hidden, !!document.querySelector('#game-frame-host iframe'), document.body.classList.contains('game-locked')]` → Expected `[false, true, true]`.
2. Evaluate `document.querySelector('#game-frame-host iframe').src` → ends with `/games/_test/index.html` (no query — no music playing).
3. `document.getElementById('game-close').click()` → evaluate `[document.getElementById('game-overlay').hidden, document.querySelectorAll('#game-frame-host iframe').length, document.body.classList.contains('game-locked')]` → Expected `[true, 0, false]`.
4. Double-open guard: click the tile twice rapidly (`const b=document.querySelector('.game-tile-btn'); b.click(); b.click();`) → `document.querySelectorAll('#game-frame-host iframe').length` → Expected `1`. Close it.
5. Scroll restore: `window.scrollTo(0, 3000)`; note `window.scrollY`; open tile; evaluate `window.scrollY` after opening (may be 0 in fullscreen); close; evaluate `window.scrollY` → Expected: the noted value.
6. Back button: open tile → `history.back()` → overlay hidden, iframe count 0, page did not navigate away (`location.pathname` unchanged).
7. Escape inside game: open tile → focus iframe → dispatch Escape inside it: `document.querySelector('#game-frame-host iframe').contentDocument.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}))` → overlay hidden.
8. Music modal: start a catalog track playing (click a store card's play button), then click the game tile → evaluate `document.getElementById('game-music-dialog').open` → Expected `true`.
   - Click `#game-music-keep` → iframe src ends with `?mjmute=1` AND `!document.getElementById('store-audio').paused` is `true`. Close game — audio still playing.
   - Repeat with `#game-music-game` → iframe src has no query AND store audio `paused === true`.
9. Keyboard focus: with the overlay open, evaluate `document.querySelector('#game-frame-host iframe').contentDocument.getElementById('key-value').textContent` after sending a key to the iframe window — the test page's "last key" updates.

Expected: every observation exactly as stated. Any deviation: stop, fix, re-run the failing item.

- [ ] **Step 5: Commit**

```bash
git add script.js
git commit -m "add: game overlay lifecycle + keep-listening music modal"
```

---

### Task 7: llms.txt mirror line

**Files:**
- Modify: `llms.txt`

- [ ] **Step 1: Read `llms.txt`, find the section that mirrors the page's section order, and add a games entry whose prose is copied VERBATIM from the new section's rendered text (label `// games · free · in-browser`, tile name, credit line). Do not draft new prose — mirror only what `index.html` renders.**

- [ ] **Step 2: Commit**

```bash
git add llms.txt
git commit -m "add: games section to llms.txt mirror"
```

---

### Task 8: Triple-comb styling passes (structure → polish → consistency)

**Files:**
- Modify: `style.css`, possibly `index.html` (class hooks only)

Per the brief, run three deliberate styling passes over the games section + overlay + dialog BEFORE any real game lands:

- [ ] **Pass 1 — structure:** invoke the `frontend-design` skill; review grid rhythm, tile proportions, chrome layout against the rest of the page (spacing scale, `--radius`, glass idiom). Apply changes.
- [ ] **Pass 2 — polish:** invoke the `hallmark` skill (audit mode) on the games section; hover/press states, focus-visible rings, transition timing consistent with `.store-card`. Apply changes.
- [ ] **Pass 3 — consistency/detail sweep:** re-check both against the whole page: AA contrast (`--text-muted` floor), Reduce Motion (no new ambient motion; overlay open/close must not animate under `prefers-reduced-motion`), lowercase copy, `&nbsp;·&nbsp;` separators in labels.
- [ ] Commit after each pass:

```bash
git add style.css index.html
git commit -m "style: games section pass N — <one-line summary>"
```

---

### Task 9: Stage 0 gate — verification before completion

REQUIRED SUB-SKILL: `superpowers:verification-before-completion`.

- [ ] **Lighthouse mobile:** run `npx lighthouse http://localhost:8080/ --preset=mobile --quiet --chrome-flags="--headless"` (or the DevTools audit) → performance ≥ 90 (baseline 98 — the shell must not regress it; the placeholder tile has no image, so no CLS).
- [ ] **Full acceptance re-run:** every check in Task 6 Step 4, clean pass, in order.
- [ ] **Reduced-motion spot check:** emulate `prefers-reduced-motion: reduce`, open/close a game — no ambient animation introduced.
- [ ] **Deployed-header check (after push/deploy):** `curl -s -D - -o /dev/null -H "User-Agent: Mozilla/5.0" https://matthewjamison.dev/games/_test/index.html` → shows `x-frame-options: SAMEORIGIN` and the games CSP (NOT the site's strict CSP, NO `require-trusted-types-for`); `curl` the site root the same way → strict CSP unchanged. (Cloudflare 403s non-browser UAs — always send a browser UA.)
- [ ] **Device matrix (user-assisted):** desktop Chrome/Firefox + desktop Safari runs by executor via browser tool where possible; iPhone/iPad/Android passes are Matthew's hardware — report readiness and hand over the checklist from spec §6 rather than claiming the gate passed.
- [ ] **Report:** file count + largest file (`git ls-files | wc -l`, `find . -type f -not -path './.git/*' -size +20M`) against Pages limits, stated in the completion summary.

---

## Fable review checkpoint (end of Stage 0)

Stop here. Fable reviews the shipped shell against spec §§1–4 + gate results, then writes the Stage 1 plan (vendoring 2048 → tiny-platformer → floppybird: per-game §4a CSP normalization, LICENSE, shim copy, thumbnails, per-slug `_headers` policies, tile swaps). Stages 2 (HexGL) and 3 (Sandspiel) each get their own plan at their own checkpoint — their exact code depends on the vendored repos' actual contents.
