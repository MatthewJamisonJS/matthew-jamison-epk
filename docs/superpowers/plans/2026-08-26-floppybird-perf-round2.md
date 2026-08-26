# Floppybird Perf Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining mobile main-thread costs in floppybird (per-tap media-element audio, per-point score DOM churn, per-spawn pipe layer allocation) and add a `?debug`-only perf HUD, verified against a deterministic Node harness baseline captured before any change.

**Architecture:** All gameplay changes live in `games/floppybird/js/main.js` (vanilla ES5, no build step). Audio moves from buzz/HTMLMediaElement to Web Audio buffers behind two small functions (`initAudio`, `playSound`). Score digits reuse `<img>` nodes. Pipes recycle through a 4-element pool. A Node `vm` harness (`docs/superpowers/harness/` — `docs/` is pruned by deploy.yml, never deployed) replays a deterministic game and logs every spawn/score/death event; the JSON log must be byte-identical before and after each task.

**Tech Stack:** Vanilla JS (ES5 style, match main.js), Web Audio API, Node ≥18 (`node:vm`), Cloudflare Pages `_headers` CSP.

**Constraints that bind every task:**
- CSP has no `'unsafe-inline'`: no `<style>`/`<script>` blocks, no `style=""` attributes, no `innerHTML`/`insertAdjacentHTML` (Trusted Types). `element.style.setProperty`/`.style.x =` and `textContent` are fine.
- Spec: `docs/superpowers/specs/2026-08-26-floppybird-perf-round2-design.md`.
- Commit style: normal prose, NO AI co-author attribution. STOP on any 1Password ssh-sign error ("failed to fill whole buffer") — never `--no-gpg-sign`; report and wait.
- Keep upstream's coding style in main.js (3-space indent, `var`, comment voice).

---

### Task 1: Deterministic harness + baseline capture

**Files:**
- Create: `docs/superpowers/harness/floppybird-sim.mjs`
- Create: `docs/superpowers/harness/baseline.json` (generated)

- [ ] **Step 0: Story**

```
In order to prove round-2 changes alter smoothness and nothing else,
the maintainer wants a deterministic replay whose event log is identical
before and after each change.
```

- [ ] **Step 1: Acceptance scenario**

```gherkin
Scenario: Baseline replay is deterministic
  Given the current main.js and a seeded RNG
  When the harness replays 30 simulated seconds twice
  Then both runs emit the identical event log (spawns, scores, death)
```

- [ ] **Step 2: Write the harness**

Write `docs/superpowers/harness/floppybird-sim.mjs` exactly:

```js
// Deterministic replay of games/floppybird/js/main.js in node:vm.
// Stubs just enough DOM/jQuery/buzz for the game to run headless, drives a
// manual 60Hz clock, autopilots the bird, and logs every pipe spawn, score,
// and death. Output is JSON on stdout; byte-identical output before/after a
// change is the parity gate. Never deployed: docs/ is pruned by deploy.yml.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, '../../../games/floppybird/js/main.js'), 'utf8');

const events = [];
let now = 0;

// ── element stub ──
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: {},
    children: [],
    attrs: {},
    parent: null,
    className: '',
    id: '',
    textContent: '',
    appendChild(c) { c.parent = el; el.children.push(c); return c; },
    remove() {
      if (el.parent) {
        const i = el.parent.children.indexOf(el);
        if (i >= 0) el.parent.children.splice(i, 1);
        el.parent = null;
      }
    },
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    addEventListener() {},
    canPlayType() { return ''; },   // audio probe → m4a branch, never fetched
  };
  return el;
}

const byId = {};
function getEl(id) { return byId[id] || (byId[id] = makeEl('div')); }

// ── jQuery stub: chainable no-ops + the few real behaviours main.js needs ──
function jqObject(sel) {
  const el = typeof sel === 'string' && sel[0] === '#'
    ? getEl(sel.slice(1))
    : makeEl('div');
  const o = {
    0: el,
    length: 1,
    height: () => 420,
    css: () => o,
    transition: (props, dur, ease, cb) => { if (cb) cb(); return o; },
    stop: () => o,
    remove: () => o,
    empty: () => o,
    append: () => o,
    children: () => o,
    show: () => o,
    click: () => o,
    keydown: () => o,
    on: () => o,
    ready: (fn) => { readyFns.push(fn); return o; },
  };
  return o;
}
const readyFns = [];
const $ = (sel) => jqObject(sel);

// ── timers + rAF under manual clock ──
const intervals = [];
let rafcb = null;

// ── seeded RNG (LCG) so pipe heights replay identically ──
let seed = 42;
function seededRandom() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

const documentStub = {
  cookie: '',
  getElementById: getEl,
  createElement: makeEl,
  addEventListener() {},
  body: makeEl('body'),
};

const context = {
  console,
  Math: Object.create(Math),
  Date,
  document: documentStub,
  navigator: { userAgent: '' },
  $, jQuery: $,
  Image: function () { this.src = ''; },
  fetch: () => Promise.reject(new Error('no network in harness')),
  setInterval(fn, ms) { intervals.push({ fn, ms, next: now + ms, dead: false }); return intervals.length; },
  clearInterval(id) { if (intervals[id - 1]) intervals[id - 1].dead = true; },
  buzz: {
    sound: function () {
      this.play = () => this; this.stop = () => this;
      this.setVolume = () => this;
      this.bindOnce = (ev, cb) => { cb(); return this; };
    },
    all: () => ({ setVolume() {} }),
  },
};
context.Math.random = seededRandom;
context.window = context;
context.window.location = { search: '' };
context.requestAnimationFrame = (fn) => { rafcb = fn; return 1; };
context.cancelAnimationFrame = () => { rafcb = null; };
vm.createContext(context);
vm.runInContext(source, context);

// document.ready
readyFns.forEach((fn) => fn());

// hook the game's own functions for the event log
const origScore = context.playerScore;
context.playerScore = function () {
  origScore();
  events.push({ t: Math.round(now), ev: 'score', score: context.score });
};
const origDead = context.playerDead;
context.playerDead = function () {
  events.push({
    t: Math.round(now), ev: 'death',
    position: Number(context.position.toFixed(4)),
    score: context.score,
  });
  origDead();
};
const origUpdatePipes = context.updatePipes;
context.updatePipes = function () {
  const before = context.livepipes.length;
  origUpdatePipes();
  if (context.livepipes.length > before) {
    const p = context.livepipes[context.livepipes.length - 1];
    events.push({ t: Math.round(now), ev: 'spawn', top: p.top, x: p.x });
  }
};

// start the run: splash → first tap
context.showSplash();
context.screenClick();

// autopilot: flap whenever the bird sinks below the next gap's midpoint
const FRAME = 1000 / 60;
let dead = false;
const realDead = context.playerDead;
context.playerDead = function () { dead = true; realDead(); };

while (!dead && now < 30000) {
  now += FRAME;
  for (const t of intervals) {
    if (t.dead) continue;
    while (t.next <= now) { t.fn(); t.next += t.ms; }
  }
  const target = context.pipes[0] ? context.pipes[0].top + 55 : 200;
  if (context.position > target && context.currentstate === 1) context.playerJump();
  if (rafcb) { const cb = rafcb; rafcb = null; cb(now); }
}

events.push({ t: Math.round(now), ev: 'end', score: context.score, dead });
process.stdout.write(JSON.stringify(events, null, 1) + '\n');
```

- [ ] **Step 3: Run it twice, confirm determinism (scenario check)**

```bash
node docs/superpowers/harness/floppybird-sim.mjs > /tmp/run1.json
node docs/superpowers/harness/floppybird-sim.mjs > /tmp/run2.json
diff /tmp/run1.json /tmp/run2.json && echo DETERMINISTIC
```

Expected: `DETERMINISTIC`, and the log contains `spawn`, `score`, and `end` events (autopilot should survive ≥ a few pipes; a `death` event is fine too — determinism is the gate, not survival). If the harness throws, fix the stub it names — do NOT touch main.js in this task.

- [ ] **Step 4: Capture baseline**

```bash
node docs/superpowers/harness/floppybird-sim.mjs > docs/superpowers/harness/baseline.json
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/harness/floppybird-sim.mjs docs/superpowers/harness/baseline.json
git commit -m "test: deterministic floppybird replay harness + baseline event log"
```

---

### Task 2: Web Audio sound engine

**Files:**
- Modify: `games/floppybird/js/main.js` (lines 45–54 buzz block; call sites 117-118, 351-356, 443-456, 481-483, 489-492, 512-514, 526-533)
- Modify: `games/floppybird/index.html` (drop buzz `<script>`, line 56)
- Modify: `_headers` (floppybird CSP block, lines 123–142)

- [ ] **Step 0: Story**

```
In order to flap without a frame hitch,
a phone player wants sound effects that cost nothing on the main thread.
```

- [ ] **Step 1: Acceptance scenario**

```gherkin
Scenario: Sound engine swap changes no gameplay event
  Given the baseline event log from Task 1
  When the harness replays after the audio swap
  Then the event log is byte-identical to baseline

Scenario: Muted embed stays silent
  Given the game loaded with ?mjmute=1
  When sfx events fire
  Then no audible output (mj-mute zero-gains the AudioContext destination)
```

- [ ] **Step 2: Replace the buzz block (main.js lines 45–54)**

Delete lines 45–54 (`//sounds` through `buzz.all().setVolume(volume);`) including `var volume = 30;` on line 46. Insert:

```js
//sounds — Web Audio: each effect is decoded once into a buffer and played
//through one shared gain node. buzz's per-tap stop()/play() on an
//HTMLMediaElement costs main-thread time on mobile; a buffer source is
//fire-and-forget on the audio thread. the context is created at boot (it can
//decode while suspended) and resumed on the first gesture.
var audioctx = null;
var sfxgain = null;
var sfxbuffers = {};
var sfxplaying = {};
var sfxnames = ["sfx_wing", "sfx_point", "sfx_hit", "sfx_die", "sfx_swooshing"];

function initAudio()
{
   var Ctx = window.AudioContext || window.webkitAudioContext;
   if(!Ctx || audioctx)
      return;
   audioctx = new Ctx();
   sfxgain = audioctx.createGain();
   sfxgain.gain.value = 0.3; //parity with buzz's volume 30
   sfxgain.connect(audioctx.destination);

   //ogg for chrome/firefox; safari's decoder has no ogg, so it gets m4a
   var format = document.createElement("audio").canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "m4a";
   for(var i = 0; i < sfxnames.length; i++)
      (function(name) {
         fetch("assets/sounds/" + name + "." + format)
            .then(function(res) { return res.arrayBuffer(); })
            .then(function(data) { return audioctx.decodeAudioData(data); })
            .then(function(buffer) { sfxbuffers[name] = buffer; })
            .catch(function() { /* the sound stays silent; the game must not */ });
      })(sfxnames[i]);
}

function resumeAudio()
{
   //iOS creates the context suspended outside a gesture; resume is idempotent
   if(audioctx && audioctx.state === "suspended")
      audioctx.resume();
}

//fire and forget. a replay of the same effect stops the one still playing,
//which is what buzz's stop()+play() pairs did. returns the source so the
//death chain can wait on ended, or null when the effect can't play.
function playSound(name, onended)
{
   if(!audioctx || !sfxbuffers[name])
      return null;
   var prev = sfxplaying[name];
   if(prev)
   {
      prev.onended = null;
      try { prev.stop(); } catch(e) { /* already ended */ }
   }
   var source = audioctx.createBufferSource();
   source.buffer = sfxbuffers[name];
   source.connect(sfxgain);
   sfxplaying[name] = source;
   source.onended = function() {
      if(sfxplaying[name] === source)
         sfxplaying[name] = null;
      if(onended)
         onended();
   };
   source.start(0);
   return source;
}

//play a sound and continue when it ends — continuing immediately if it
//couldn't play, so the score screen never waits on missing audio.
function playSoundThen(name, next)
{
   if(playSound(name, next) === null)
      next();
}
```

- [ ] **Step 3: Update every call site in main.js**

In `$(document).ready(...)` (line 66–81), after `playerelement = document.getElementById("player");` add:

```js
   initAudio();
```

In `showSplash()` replace (lines 117–118):

```js
   soundSwoosh.stop();
   soundSwoosh.play();
```

with:

```js
   playSound("sfx_swooshing");
```

In `screenClick()` add `resumeAudio();` as the FIRST line of the function body (before the state checks — the gesture must reach the context on splash taps too).

In `playerJump()` replace the two `soundJump` lines with:

```js
   playSound("sfx_wing");
```

In `playerScore()` replace the two `soundScore` lines with:

```js
   playSound("sfx_point");
```

In `playerDead()` replace the whole `if(isIncompatible.any()) { ... } else { ... }` block (lines 442–456) with:

```js
   //mobile browsers skipped buzz's ended events; keep that shape — straight
   //to the score screen there, the hit→die chain elsewhere
   if(isIncompatible.any())
   {
      //skip right to showing score
      showScore();
   }
   else
   {
      //play the hit sound (then the dead sound) and then show score
      playSoundThen("sfx_hit", function() {
         playSoundThen("sfx_die", function() {
            showScore();
         });
      });
   }
```

In `showScore()` replace both `soundSwoosh.stop(); soundSwoosh.play();` pairs (lines 481–483 and 489–491) with `playSound("sfx_swooshing");` each. Same replacement in the `#replay` click handler (lines 512–514).

- [ ] **Step 4: Drop buzz from index.html**

Remove line 56: `<script src="js/buzz.min.js"></script>`. Leave `js/buzz.min.js` on disk (vendoring parity; unreferenced).

- [ ] **Step 5: CSP — floppybird block in `_headers`**

The block at lines 139–143 currently has no `connect-src` (fetch would be blocked) and a `media-src` that nothing uses once buzz is gone. Replace the CSP line with:

```
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'
```

Update the evidence comment above (lines 123–127): the claim "no fetch/XHR/WebSocket/sendBeacon" is now wrong. Reword that sentence to:

```
# audit: no inline <script>/<style> blocks, no document.write, no <form>. The
# only fetch is main.js loading its five same-origin sfx buffers for Web Audio
# (connect-src 'self'); buzz and its media elements are gone, so media-src is
# dropped. No XHR/WebSocket/sendBeacon. The upstream third-party analytics ...
```

(keep the rest of the original comment's content intact).

- [ ] **Step 6: Parity check (scenario 1)**

```bash
node docs/superpowers/harness/floppybird-sim.mjs > /tmp/after-audio.json
diff docs/superpowers/harness/baseline.json /tmp/after-audio.json && echo PARITY
```

Expected: `PARITY`. The harness has no `AudioContext`, so `initAudio` returns early and `playSoundThen` falls through `next()` immediately — same as the buzz stub's immediate `bindOnce` callback.

- [ ] **Step 7: Manual smoke (local server)**

```bash
python3 -m http.server 8080 --directory games/floppybird &
```

Open `http://localhost:8080/` in a real browser (headless renders black on this project): flap sound on tap/click, hit→die→scoreboard on death, no console errors. Then `http://localhost:8080/?mjmute=1` — silence. Kill the server.

- [ ] **Step 8: Commit**

```bash
git add games/floppybird/js/main.js games/floppybird/index.html _headers
git commit -m "perf: floppybird audio to Web Audio buffers — no media-element seek per flap

buzz stop()/play() per tap ran on the main thread; buffers play on the
audio thread. Death-chain and mute (?mjmute=1) behavior preserved;
floppybird CSP gains connect-src 'self' for the sfx fetch and loses the
now-unused media-src."
```

---

### Task 3: Score digits without churn + image warm-up

**Files:**
- Modify: `games/floppybird/js/main.js` (`setBigScore` 359, `setSmallScore` 372, `setHighScore` 382, ready handler)

- [ ] **Step 0: Story**

```
In order to score without a stutter,
a player wants the counter to update without allocating or decoding anything.
```

- [ ] **Step 1: Acceptance scenario**

```gherkin
Scenario: Scoring reuses nodes
  Given a score change from 9 to 10
  When the big score re-renders
  Then existing <img> nodes are reused and one is added — none destroyed
Scenario: Replay parity
  Given the Task 1 baseline
  When the harness replays after this change
  Then the event log is byte-identical
```

- [ ] **Step 2: Replace the three score renderers**

Replace `setBigScore`, `setSmallScore`, `setHighScore` (lines 359–390) with:

```js
//score digits: the img nodes are reused in place — src swaps only, a node is
//added only when the number gains a digit, surplus nodes are hidden. the old
//empty()+append() built fresh imgs every point, which decoded and laid out
//mid-game.
function setDigits(container, prefix, value)
{
   var digits = value.toString();
   while(container.children.length < digits.length)
      container.appendChild(document.createElement("img"));
   var imgs = container.children;
   for(var i = 0; i < imgs.length; i++)
   {
      if(i < digits.length)
      {
         var src = "assets/" + prefix + digits.charAt(i) + ".png";
         if(imgs[i].getAttribute("src") !== src)
         {
            imgs[i].setAttribute("src", src);
            imgs[i].alt = digits.charAt(i);
         }
         imgs[i].style.display = "";
      }
      else
         imgs[i].style.display = "none";
   }
}

function setBigScore(erase)
{
   var container = document.getElementById("bigscore");
   if(erase)
   {
      for(var i = 0; i < container.children.length; i++)
         container.children[i].style.display = "none";
      return;
   }
   setDigits(container, "font_big_", score);
}

function setSmallScore()
{
   setDigits(document.getElementById("currentscore"), "font_small_", score);
}

function setHighScore()
{
   setDigits(document.getElementById("highscore"), "font_small_", highscore);
}
```

Note `#bigscore img { display: inline-block }` in main.css — setting `style.display = ""` falls back to that rule; never set `"inline-block"` explicitly.

- [ ] **Step 3: Warm the images at boot**

In the `$(document).ready(...)` handler, after `initAudio();` add:

```js
   //decode the state-transition artwork up front so a first medal or first
   //score never pays a decode mid-session. Image() warms the cache; decode()
   //rasterizes where supported.
   var warmlist = ["scoreboard.png", "replay.png",
      "medal_bronze.png", "medal_silver.png", "medal_gold.png", "medal_platinum.png"];
   for(var d = 0; d <= 9; d++)
      warmlist.push("font_big_" + d + ".png", "font_small_" + d + ".png");
   for(var w = 0; w < warmlist.length; w++)
   {
      var warm = new Image();
      warm.src = "assets/" + warmlist[w];
      if(warm.decode)
         warm.decode().catch(function() { /* decode is best-effort */ });
   }
```

- [ ] **Step 4: Parity + smoke**

```bash
node docs/superpowers/harness/floppybird-sim.mjs > /tmp/after-score.json
diff docs/superpowers/harness/baseline.json /tmp/after-score.json && echo PARITY
```

Expected: `PARITY`. Browser smoke: score past 9 (two digits appear), die, scoreboard shows current + high score + medal at ≥10.

- [ ] **Step 5: Commit**

```bash
git add games/floppybird/js/main.js
git commit -m "perf: floppybird score digits reuse img nodes; warm state art at boot"
```

---

### Task 4: Pipe pooling

**Files:**
- Modify: `games/floppybird/js/main.js` (`updatePipes` 535–565, reap in `rendergame` 297–303, sweep in `showSplash` 120–123)

- [ ] **Step 0: Story**

```
In order to keep every 1400ms spawn free,
the game wants to recycle pipe elements instead of building new layers.
```

- [ ] **Step 1: Acceptance scenario**

```gherkin
Scenario: Pooling changes no geometry
  Given the Task 1 baseline
  When the harness replays after pooling
  Then spawn times, gap tops, score times, and death are byte-identical
```

- [ ] **Step 2: Add the pool + element builder (above `updatePipes`)**

```js
//pipes are recycled: an offscreen pipe's element goes back in the pool and the
//next spawn reuses it, so no dom subtree or will-change layer is built
//mid-game. four covers the most ever alive at once.
var pipepool = [];

function acquirePipeElement()
{
   if(pipepool.length)
      return pipepool.pop();
   var el = document.createElement("div");
   el.className = "pipe animated";
   var upper = document.createElement("div");
   upper.className = "pipe_upper";
   var lower = document.createElement("div");
   lower.className = "pipe_lower";
   el.appendChild(upper);
   el.appendChild(lower);
   return el;
}

function releasePipe(pipe)
{
   pipe.element.remove();
   if(pipepool.length < 4)
      pipepool.push(pipe.element);
}
```

- [ ] **Step 3: Rewrite the spawn tail of `updatePipes`**

Replace from `var newpipe = $('<div class="pipe animated">...` through the end of the function (lines 553–564) with:

```js
   //heights and transform are applied through CSSOM, not an inline style
   //attribute: the page ships under a CSP with no style-src 'unsafe-inline'.
   //the transform is set before the element is (re)appended so a recycled
   //pipe can never paint one frame at its old position.
   var el = acquirePipeElement();
   el.children[0].style.height = topheight + "px";
   el.children[1].style.height = bottomheight + "px";
   el.style.transform = "translateX(" + pipestartx + "px)";
   document.getElementById("flyarea").appendChild(el);

   //tracked as numbers from here on: x is the pipe's left edge inside
   //#flyarea and top is where its gap starts. the loop moves x and writes it
   //back out as a translateX, so a pipe never touches layout.
   var pipe = { element: el, x: pipestartx, top: topheight };
   pipes.push(pipe);
   livepipes.push(pipe);
```

- [ ] **Step 4: Route both removal paths through the pool**

In `rendergame` (line 299–303) replace `pipe.element.remove();` with `releasePipe(pipe);` (the `livepipes.splice(i, 1);` line stays).

In `showSplash` replace (lines 120–123):

```js
   //clear out all the pipes if there are any
   $(".pipe").remove();
   pipes = new Array();
   livepipes = new Array();
```

with:

```js
   //clear out all the pipes if there are any — back into the pool, not the gc
   for(var i = 0; i < livepipes.length; i++)
      releasePipe(livepipes[i]);
   pipes = new Array();
   livepipes = new Array();
```

- [ ] **Step 5: Parity + smoke**

```bash
node docs/superpowers/harness/floppybird-sim.mjs > /tmp/after-pool.json
diff docs/superpowers/harness/baseline.json /tmp/after-pool.json && echo PARITY
```

Expected: `PARITY`. Browser smoke: play two full games (pipes recycled on replay), heights vary per spawn, collision feels unchanged.

- [ ] **Step 6: Commit**

```bash
git add games/floppybird/js/main.js
git commit -m "perf: floppybird pipes recycle through a 4-element pool"
```

---

### Task 5: `?debug` perf HUD

**Files:**
- Modify: `games/floppybird/js/main.js` (`gameloop` 169–194, `startGame` 133)

- [ ] **Step 0: Story**

```
In order to judge smoothness with numbers instead of feel,
the maintainer wants frame stats on screen — in ?debug only.
```

- [ ] **Step 1: Acceptance scenario**

```gherkin
Scenario: HUD exists only under ?debug
  Given the game loaded without ?debug
  When any number of games are played
  Then no HUD element is ever created
Scenario: HUD reports the window
  Given ?debug and a running game
  When 500ms of frames elapse
  Then the HUD shows fps, worst frame ms over ~5s, and long-frame count/total
```

- [ ] **Step 2: Add the HUD (below the `rendergame` function)**

```js
//?debug frame hud: counters accumulate per frame, the text flushes twice a
//second via textContent (trusted-types safe), and nothing here reads layout.
//no ?debug → updateHud is never called and no node is ever created.
var hud = null;
var hudframes = 0;
var hudlongtotal = 0;
var hudtotalframes = 0;
var hudworsts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
var hudworstidx = 0;
var hudwindowworst = 0;
var hudlastflush = 0;

function resetHud()
{
   hudframes = 0;
   hudlongtotal = 0;
   hudtotalframes = 0;
   hudworsts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
   hudworstidx = 0;
   hudwindowworst = 0;
   hudlastflush = 0;
}

function updateHud(timestamp, delta)
{
   hudframes++;
   hudtotalframes++;
   if(delta > 33)
      hudlongtotal++;
   if(delta > hudwindowworst)
      hudwindowworst = delta;
   if(!hudlastflush)
   {
      hudlastflush = timestamp;
      return;
   }
   if(timestamp - hudlastflush < 500)
      return;

   if(!hud)
   {
      hud = document.createElement("div");
      hud.id = "perfhud";
      var s = hud.style;
      s.position = "fixed";
      s.top = "4px";
      s.right = "4px";
      s.zIndex = "2000";
      s.padding = "4px 6px";
      s.background = "rgba(0,0,0,0.7)";
      s.color = "#0f0";
      s.font = "11px/1.4 monospace";
      s.pointerEvents = "none";
      s.whiteSpace = "pre";
      document.body.appendChild(hud);
   }

   var fps = Math.round(hudframes * 1000 / (timestamp - hudlastflush));
   hudworsts[hudworstidx] = hudwindowworst;
   hudworstidx = (hudworstidx + 1) % hudworsts.length;
   var worst = 0;
   for(var i = 0; i < hudworsts.length; i++)
      if(hudworsts[i] > worst)
         worst = hudworsts[i];
   hud.textContent = fps + " fps\nworst(5s) " + worst.toFixed(1) + "ms\nlong " + hudlongtotal + "/" + hudtotalframes;

   hudframes = 0;
   hudwindowworst = 0;
   hudlastflush = timestamp;
}
```

- [ ] **Step 3: Wire it into the loop**

In `gameloop`, immediately after the `delta > 250` clamp, add:

```js
   if(debugmode)
      updateHud(timestamp, delta);
```

In `startGame`, before the loops start, add:

```js
   if(debugmode)
      resetHud();
```

- [ ] **Step 4: Parity + verification**

```bash
node docs/superpowers/harness/floppybird-sim.mjs > /tmp/after-hud.json
diff docs/superpowers/harness/baseline.json /tmp/after-hud.json && echo PARITY
grep -c 'perfhud' games/floppybird/js/main.js
```

Expected: `PARITY` (harness runs without `?debug`, so `debugmode` is false and updateHud never fires). Browser: `http://localhost:8080/?debug` shows the green HUD during play; without `?debug`, `document.getElementById('perfhud')` is null after a full game.

- [ ] **Step 5: Commit**

```bash
git add games/floppybird/js/main.js
git commit -m "feat: floppybird ?debug frame hud — fps, 5s worst, long-frame count"
```

---

### Task 6: Other-games perf audit (report only — read-only agent)

**Files:**
- Create: `docs/superpowers/specs/2026-08-26-games-perf-audit.md`

- [ ] **Step 1: Audit** `games/2048`, `games/tiny-platformer`, `games/sandspiel` loop/render/input paths. For each: per-frame DOM reads/writes, allocation in hot loops, canvas size vs devicePixelRatio (sandspiel: wasm + regl — note, don't patch), input listener passiveness, timers vs rAF, layer counts. Every finding = file:line evidence + expected mobile impact (high/med/low) + proposed fix. No code changes.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-26-games-perf-audit.md
git commit -m "docs: mobile perf audit of 2048, tiny-platformer, sandspiel"
```

---

### Task 7: Preview deploy + device gate (Matthew's hands)

- [ ] Deploy preview replica of the branch: mirror what deploy.yml does (prune `worker/ docs/`) into a scratch copy, then

```bash
wrangler pages deploy <scratch-copy> --project-name=matthew-jamison-epk --branch=games-floppybird-perf2
```

- [ ] Hand Matthew: `https://games-floppybird-perf2.matthew-jamison-epk.pages.dev/games/floppybird/?debug` on iPhone Safari + Android Chrome. Gate: 60s of play, HUD `long` count under ~5% of total frames, no hitch on tap, feel pass. Also spot-check `?mjmute=1` silence and death→scoreboard flow.
- [ ] **Merge ONLY after Matthew reports the device pass.** If jank persists, capture HUD numbers and loop back — next suspects in order: strip `animated` play/pause jQuery sweeps, land/sky layer sizes, `steps(4)` bird sprite.

---

## Self-review notes

- Spec coverage: audio (Task 2), score reuse + warm-up (Task 3), pooling (Task 4), HUD (Task 5), audit (Task 6), device gate + no-early-merge (Task 7), harness parity thread through all. ✔
- `playSoundThen` defined Task 2, used only Task 2. `setDigits` defined and used Task 3. `acquirePipeElement`/`releasePipe` defined and used Task 4. Names consistent. ✔
- Harness stubs cover both pre- and post-change main.js: jQuery `$('<div ...>')` constructor path (baseline) and `document.createElement` path (after Task 4); `fetch` reject + missing `AudioContext` make the audio module inert both sides. ✔
