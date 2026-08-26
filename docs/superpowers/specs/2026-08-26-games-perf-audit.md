# Mobile perf audit — 2048, tiny-platformer, sandspiel

**Date:** 2026-08-26
**Branch:** `games-floppybird-perf2`
**Scope:** static read-only audit of the three vendored games *other than* floppybird
(floppybird is being rewritten separately and is out of scope here).
**Status:** report only. No game file was modified by this audit.

Audit dimensions per game: per-frame DOM reads/writes, allocation in hot loops,
canvas backing size vs `devicePixelRatio`, input listener passiveness, timers vs
`requestAnimationFrame`, composited layer count, decode work in hot paths.

Sandspiel is a wasm + regl/WebGL build. Only its JS glue was audited. **No wasm
patch is proposed anywhere in this document.**

Finding counts: **tiny-platformer 6**, **2048 5**, **sandspiel 8**, **cross-game 1**
(20 total; 5 high, 8 medium, 7 low).

---

## 1. tiny-platformer

Vanilla `<canvas>` 2D, one rAF loop, fixed-timestep accumulator. This is the worst
of the three on mobile: every frame does a full-screen 2048×1536 clear plus ~3000
individual `fillRect` calls.

### TP-1 — canvas backing store is 4× supersampled (HIGH)

`games/tiny-platformer/platformer.js:67-68`

```js
width    = canvas.width  = MAP.tw * TILE,   // 64 * 32 = 2048
height   = canvas.height = MAP.th * TILE,   // 48 * 32 = 1536
```

`games/tiny-platformer/platformer.css:2-3` pins the CSS box to `512×384` at every
viewport below 840px — i.e. every phone. So the backing store is 2048×1536 =
3.15M pixels (~12.6MB RGBA), and the compositor then downscales it 4:1. On a
dpr-2 phone the *useful* backing size is 1024×768; on dpr-3, 1536×1152 — both
below what is allocated, and both far below what is being filled.

Every frame pays for all 3.15M pixels: the `clearRect` at `platformer.js:245`, the
map fill (TP-2), and the final composite/downscale.

**Fix:** decouple world coordinates from the backing store. Keep the world at
2048×1536 logical units, set `canvas.width/height` to
`cssBox × min(devicePixelRatio, 2)` and apply a single
`ctx.setTransform(scale, 0, 0, scale, 0, 0)` after each resize. At 512×384 CSS on
dpr-2 that is 1024×768 = 786k pixels, a **4× reduction in per-frame fill**.

### TP-2 — the static tile map is re-rasterised tile-by-tile every frame (HIGH)

`games/tiny-platformer/platformer.js:252-263`, called from `render()` at
`platformer.js:246`

```js
for(y = 0 ; y < MAP.th ; y++) {
  for(x = 0 ; x < MAP.tw ; x++) {
    cell = tcell(x, y);
    if (cell) {
      ctx.fillStyle = COLORS[cell - 1];
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }
}
```

3072 loop iterations per frame, each solid cell costing a `fillStyle` string
assignment (parsed to a colour every time) plus a `fillRect`. The map is loaded
once at `platformer.js:327` (`cells = data`) and is **never mutated** — this is
pure waste, repeated 60×/second.

**Fix:** rasterise the map once into an `OffscreenCanvas` (or a detached
`<canvas>`) at `setup()`, then `renderMap` becomes a single
`ctx.drawImage(mapCanvas, 0, 0)`. Also hoist `fillStyle` out of the inner loop by
batching cells per colour if the offscreen route is rejected. Combined with TP-1
this is the difference between "playable" and "playable at 60fps" on a mid-range
Android.

### TP-3 — no touch input: the game is unplayable on a phone (MED, and a usability bug)

`games/tiny-platformer/platformer.js:372-373`

```js
document.addEventListener('keydown', function(ev) { return onkey(ev, ev.keyCode, true);  }, false);
document.addEventListener('keyup',   function(ev) { return onkey(ev, ev.keyCode, false); }, false);
```

Keyboard only. `platformer.js:84-90` maps LEFT/RIGHT/SPACE and nothing else. There
is no touch, pointer, or on-screen control anywhere in the file, and
`games/tiny-platformer/index.html:24-26` tells the visitor to use LEFT/RIGHT/SPACE.

The perf consequence: on mobile the rAF loop burns a full frame budget every 16ms
rendering a game the visitor cannot influence. Everything in TP-1/TP-2 is being
spent for nothing.

**Fix:** either add three touch zones (left / right / jump) as `<button>`s that set
`player.left/right/jump`, registered `{passive: true}` on `touchstart`/`touchend`
with `touch-action: none` on the buttons — or, if the game stays desktop-only,
gate the rAF loop behind a coarse-pointer check and show a "needs a keyboard"
notice instead of running the loop. Do not add non-passive document-level touch
handlers.

### TP-4 — 2D context created without `alpha: false` (MED)

`games/tiny-platformer/platformer.js:66`

```js
ctx = canvas.getContext('2d'),
```

`platformer.js:245` clears the full canvas to transparent every frame, so the
compositor must alpha-blend a 3.15M-pixel layer over `body { background: #111 }`
(`platformer.css:1`). The game never relies on seeing through the canvas.

**Fix:** `getContext('2d', { alpha: false })` and replace the `clearRect` with a
`fillRect` of the background colour. Removes a per-frame full-surface blend and
lets the browser skip the alpha channel entirely.

### TP-5 — the fixed-step accumulator can run 60 update steps in one frame (LOW-MED)

`games/tiny-platformer/platformer.js:359-370`

```js
dt = dt + Math.min(1, (now - last) / 1000);
while(dt > step) {
  dt = dt - step;
  update(step);
}
```

`step` is `1/60` and `dt` is clamped at 1 second, so a single stall can queue up to
60 `update()` calls — each of which walks every monster (`platformer.js:102-106`)
and every treasure (`platformer.js:120-127`). On mobile a stall of that size is
routine: the iframe is created on overlay open (`script.js:907-908`), and the first
frame after a mid-game backgrounding lands exactly here. The catch-up work then
causes the *next* stall.

**Fix:** cap the catch-up (`let steps = 0; while (dt > step && steps++ < 5)`) and
drop the remainder. Standard spiral-of-death guard.

### TP-6 — fixed 512px layout overflows narrow viewports (LOW)

`games/tiny-platformer/platformer.css:2` and `:6` both hard-code
`width: 512px; height: 384px` as the floor. A 390px-wide phone viewport inside the
overlay iframe gets a horizontally scrollable document, which puts a scroll
container around a canvas that repaints every frame.

**Fix:** make the base rule `width: min(512px, 100vw); aspect-ratio: 4 / 3` and let
the canvas fill it (the canvas is already `width: 100%; height: 100%`). This is a
prerequisite for TP-1 anyway, since TP-1 needs the real CSS box size.

---

## 2. 2048

No animation loop — 2048 is fully event-driven, one actuation per move. Its hot
path is therefore short and bounded at 16 tiles, so nothing here is high-impact.
The findings are all "per move" costs and load-time weight.

### T48-1 — the whole tile layer is destroyed and rebuilt on every move (MED)

`games/2048/js/html_actuator.js:13-36` (the rAF-wrapped actuate),
`:43-47` (`clearContainer`), `:49-91` (`addTile`)

```js
window.requestAnimationFrame(function () {
  self.clearContainer(self.tileContainer);
  grid.cells.forEach(...  self.addTile(cell) ...);
```

Every move removes all children one `removeChild` at a time, then creates up to
16 fresh `wrapper`+`inner` div pairs, sets `class` via `setAttribute`
(`html_actuator.js:93-95`) and `textContent`. That is ~32 element creations and
~32 style resolutions per move.

Worse, `html_actuator.js:67-72` schedules a **nested** `requestAnimationFrame`
that rewrites the class of every moving tile one frame later, so the
`transform` transition at `games/2048/style/main.css:318-323` has something to
animate from:

```js
window.requestAnimationFrame(function () {
  classes[2] = self.positionClass({ x: tile.x, y: tile.y });
  self.applyClasses(wrapper, classes); // Update the position
});
```

Result: two full style-recalc + layout passes per move, back-to-back, plus a
guaranteed dropped frame at the hand-off.

**Fix (upstream-divergent, so weigh it against keeping the vendored copy clean):**
keep 16 persistent tile nodes and mutate only `transform`/`textContent`/value
class on each. That removes the teardown, the re-creation, and the nested rAF —
the "render at the old position first" trick is only needed because the node is
brand new. If the vendored copy should stay recognisable, the cheaper half-step is
to replace `clearContainer`'s `removeChild` loop with `replaceChildren()` and
build tiles into a `DocumentFragment` before a single append.

### T48-2 — 9 blocking scripts in the iframe, 3 of them dead polyfills (MED)

`games/2048/index.html:87-96`

```html
<script src="js/bind_polyfill.js"></script>
<script src="js/classlist_polyfill.js"></script>
<script src="js/animframe_polyfill.js"></script>
... 6 more ...
```

None carry `defer`, so each is a parser-blocking round trip inside the overlay
iframe — 9 sequential HTTP fetches before the game can start. Three of them
(`Function.prototype.bind`, `classList`, `requestAnimationFrame`) polyfill APIs
that shipped in every browser a decade ago; `animframe_polyfill.js:11-14` even
installs a `setTimeout` fallback that no supported browser will ever reach.

**Fix:** delete the three polyfill files and their tags, and add `defer` to the
remaining six (load order is preserved by `defer`, and `application.js` already
waits on rAF at `js/application.js:2`). Cuts iframe TTI by 3 round trips with zero
behaviour change.

### T48-3 — synchronous `localStorage` write of the serialised grid on every move (LOW-MED)

`games/2048/js/game_manager.js:79-96`, `games/2048/js/local_storage_manager.js:58`

```js
this.storageManager.setGameState(this.serialize());   // game_manager.js:88
...
this.storage.setItem(this.gameStateKey, JSON.stringify(gameState));  // local_storage_manager.js:58
```

`Grid.prototype.serialize` (`games/2048/js/grid.js:102-117`) allocates 5 arrays and
16 objects, then `JSON.stringify` produces ~1KB, then `setItem` blocks the main
thread on a disk write. `game_manager.js:80` also reads `getBestScore()` twice per
actuate (`:80` and `:95`). Small, but it lands in the same frame as T48-1's DOM
rebuild, which is the frame the visitor is watching animate.

**Fix:** move the persist off the critical path — schedule it in a
`requestIdleCallback` (or a `setTimeout(…, 0)`) after `actuator.actuate`, and cache
`getBestScore()` in the manager instead of re-reading it.

### T48-4 — non-passive touch listeners that only exist to `preventDefault` (LOW-MED)

`games/2048/js/keyboard_input_manager.js:80-99` vs
`games/2048/style/main.css:150-151`

```js
gameContainer.addEventListener(this.eventTouchmove, function (event) {
  event.preventDefault();
});
```

The CSS already declares `touch-action: none` on `.game-container` (and again in
the ≤520px block at `main.css:583-584`), which is what actually suppresses scroll
and pinch on every browser this site supports. The listeners are registered
without an options object, so they default to non-passive: the compositor must
wait for JS on every `touchstart`/`touchmove` inside the board, and Chrome logs the
usual "non-passive event listener" intervention warning.

**Fix:** register both with `{ passive: true }` and delete the two
`preventDefault()` calls (`:94` and `:98`), relying on `touch-action: none`. Keep
the `touchend` handler as-is — it does not call `preventDefault` and needs no
change. Verify the swipe still registers on iOS Safari before merging; if it
regresses, keep `touchstart` non-passive with an explicit `{ passive: false }` so
at least the intent is declared and `touchmove` goes passive.

### T48-5 — the score container is torn down and rebuilt per move (LOW)

`games/2048/js/html_actuator.js:106-121` calls `clearContainer` on the score node,
sets `textContent`, then creates a `.score-addition` div that runs a 600ms
`move-up` animation (`games/2048/style/main.css:85-90`). One extra element
creation and one extra animated layer per scoring move.

**Fix:** keep a single persistent `.score-addition` node and restart its animation
by toggling a class (or `animation: none` → reflow → re-add). Marginal; listed for
completeness.

**Non-finding, noted:** the board uses `float: left` grid cells
(`main.css:216-222`) and `:after`-cleared rows. Ugly, but the grid is static
markup (`games/2048/index.html:46-71`) and is laid out once — no per-move cost.
Leave it.

---

## 3. sandspiel

wasm falling-sand sim (300×300 cells) + a WebGL fluid layer + a React UI, in two
stacked canvases (`games/sandspiel/index.html:12`). The bundles are minified to a
single line each, so evidence below cites **file + byte offset** (`@NNNNN`) with
the verbatim snippet. `86.e096e8a7eaac6b8de58d.js` is the app glue;
`931.ef9519c080d98187b4b3.js` is the vendor bundle; the wasm module is
`e30295bd182820ced6dd.module.wasm` and is **not** touched by any proposal here.

### SS-1 — synchronous per-frame `readPixels` on Apple devices (HIGH)

`games/sandspiel/86.e096e8a7eaac6b8de58d.js@23047`

```js
if(!t||m) x.readPixels(0,0,ue,se,x.RGBA,x.UNSIGNED_BYTE,ve);
else if(void 0===me) x.readPixels(...,0), me=x.fenceSync(x.SYNC_GPU_COMMANDS_COMPLETE,0);
else { var h=x.clientWaitSync(me,0,0); ... x.getBufferSubData(...) ... }
```

`m` is the Apple-platform detector at `86.js@12251`:

```js
m=["iPad Simulator","iPhone Simulator","iPod Simulator","iPad","iPhone","iPod"]
   .includes(navigator.platform)||navigator.userAgent.includes("Mac")&&"ontouchend"in document;
```

So on **every iPhone and iPad** the code deliberately takes the *first* branch: a
blocking `readPixels` of the whole `ue×se` (300×300) wind field — 360KB GPU→CPU —
inside the per-frame `update()` (`86.js@19900`). That is a full pipeline flush and
stall every single frame; it is the largest identifiable mobile cost in sandspiel.
The WebGL2 fence/PBO path below it exists precisely because the sync read is
expensive, and Apple is excluded from it (upstream's workaround for broken
`fenceSync` behaviour on Apple GPUs).

**Fix:** decouple the wind readback from the render rate. Read the wind field every
Nth frame (N=3 or 4) and let the wasm sim reuse the previous buffer in between, or
read back a half-resolution field. Both are pure JS-glue changes in `update()` — no
wasm edit. This is a *fidelity* tradeoff (wind responsiveness), so it needs
Matthew's sign-off on feel before it lands, and it should be measured on a real
iPhone rather than in emulation.

### SS-2 — sand canvas backing store is 300 × `ceil(devicePixelRatio)` for a 300-cell nearest-neighbour sim (HIGH)

`games/sandspiel/86.e096e8a7eaac6b8de58d.js@46226`

```js
p=300, ... E=document.getElementById("sand-canvas");
E.height=p*Math.ceil(window.devicePixelRatio),
E.width =p*Math.ceil(window.devicePixelRatio),
```

The simulation is 300×300 cells and the canvas is rendered with
`image-rendering: pixelated` (`games/sandspiel/styles.css:58-67`), so every device
pixel beyond the 300th in each axis is a nearest-neighbour copy of a neighbour —
**zero** extra detail. On a dpr-3 phone the backing store is 900×900 = 810k
fragments per frame instead of 90k: a **9× fragment-shader and fill cost for no
visual gain**.

The neighbouring fluid canvas proves the point — it is sized 1:1 to the sim at
`86.js@12400`:

```js
function p(e){var n=e.universe; v.width=n.width(); v.height=n.height();
```

(`v` is `#fluid-canvas`, `n.width()` is 300.) Two stacked canvases with different
backing resolutions for the same 300-cell world.

**Fix:** set `E.width = E.height = p` and let CSS + `image-rendering: pixelated`
do the upscale, matching what the fluid canvas already does. One-line glue change,
no wasm involvement. Verify on a retina device that the sand layer still lines up
pixel-for-pixel with the fluid layer (it should — both then map 1 texel per cell).

### SS-3 — `getBoundingClientRect()` inside the touch-paint interpolation loop (HIGH)

`games/sandspiel/86.e096e8a7eaac6b8de58d.js@51589` (the paint handler `h`):

```js
h=function(e){ if(d){ var n=o.getBoundingClientRect(),
  t=o.width/Math.ceil(window.devicePixelRatio)/n.width,
  a=o.height/Math.ceil(window.devicePixelRatio)/n.height, ...
```

and `86.js@50500` (the interpolation driver `x`, which `h` is called from):

```js
if(f) for(;u(n,f)>a;){ var o=u(n,f);
  if(f=l(f,c(s(v(f,e)),-Math.min(a,o))), ++r>1e3) break;
  h(f); }
```

Single-finger `touchmove` routes into `x` via `86.js@51368` →
`p=function(e){var n=Array.from(e.touches); 1==n.length?x(n[0]):n.forEach(h)}`.
So one fast drag event can run the interpolation loop up to **1000 iterations**,
and *each* iteration calls `h`, which forces a synchronous layout via
`getBoundingClientRect`. Hundreds of forced reflows inside a single touch event,
on the input thread, while a wasm sim and two WebGL canvases are competing for the
same frame.

The fluid module already caches its rect correctly — `86.js@18720`:

```js
var he=function(){ ie=d.getBoundingClientRect(), ae=..., oe=... };
he(); window.addEventListener("resize",he);
window.addEventListener("deviceorientation",he,!0);
```

The paint handler simply does not use that pattern.

**Fix:** hoist the rect + scale computation out of `h` into the same
resize/orientation-cached closure the fluid module uses (`ie/ae/oe` at
`86.js@18720`), and have `h` read the cached values. Also read the rect **once** in
`x` before the loop and pass the scale down. Highest-value, lowest-risk change in
sandspiel — pure layout-thrash removal with no behaviour change. Independently,
cap the loop at a much lower bound (the `1e3` guard is a runaway, not a budget).

### SS-4 — 326KB React 16 + react-dom vendor bundle for a row of buttons (MED)

`games/sandspiel/931.ef9519c080d98187b4b3.js` (326,060 bytes uncompressed),
manifest at `games/sandspiel/931.ef9519c080d98187b4b3.js.LICENSE.txt`:

```
/** @license React v16.13.1  react-is.production.min.js
/** @license React v16.14.0  react-dom.production.min.js
/*! regenerator-runtime ...
```

The entire UI this powers is `#ui` — a flex-wrapped list of element-picker
`<button>`s styled at `games/sandspiel/styles.css:71-115`. On a low-end phone,
326KB of parse + compile + hydrate is a several-hundred-millisecond block *before*
the sim's first frame, and it is loaded eagerly (`index.html:10`, `defer`, which
still blocks first render of interactive content).

**Fix:** none cheap. Options, in order of effort: (a) accept it and document the
cost — it is a vendored upstream build; (b) preload the wasm
(`<link rel="preload" as="fetch" crossorigin>` for
`e30295bd182820ced6dd.module.wasm`) so the module fetch overlaps the React parse
instead of queueing behind it — small win, zero risk; (c) replace the React UI
with plain DOM, which is a real fork of the vendored build and should not be done
inside a perf pass. **Recommend (b) now, (a) for the rest.**

### SS-5 — three `Uint8Array` views allocated every frame (MED)

`games/sandspiel/86.e096e8a7eaac6b8de58d.js@19900`

```js
update:function(){
  ve=new Uint8Array(l.buffer,n.winds(),ue*se*4),
  de=new Uint8Array(l.buffer,n.burns(),ue*se*4);
  var e=n.cells();
  fe=new Uint8Array(l.buffer,e,ue*se*4);
```

Three typed-array *views* (not copies) per frame = 180 allocations/second of GC
churn on the animation thread. Cheap individually, but they are unnecessary: the
views only need rebuilding when the wasm heap is resized or the pointers move
(grow / reset / undo-pop).

**Fix:** cache the three views and rebuild only when `l.buffer` identity changes or
`n.winds()/n.burns()/n.cells()` returns a different pointer. Guard is three
integer comparisons per frame.

### SS-6 — undebounced resize/orientation handler that reads layout 7× and writes `style` strings (MED)

`games/sandspiel/86.e096e8a7eaac6b8de58d.js@9350`

```js
var r=window.innerWidth, i="", a="";
r>window.innerHeight-50 ? r-window.innerHeight<400
  ? (i="height: ".concat(window.innerHeight,"px; margin:3px"), ...)
  : (i="\n height: ".concat(window.innerHeight,"px;\n width:").concat(window.innerHeight,"px;\n ...
  : (i="width: ".concat(r,"px; bottom:3px;"), a="");
t.style=a, e.style=i, n.style=i
```

registered at `86.js@10130`:

```js
window.addEventListener("deviceorientation",e,!0), window.addEventListener("resize",e)
```

Six reads of `window.innerHeight` plus one of `innerWidth` (interleaved with the
string building), then three whole-`style`-attribute replacements on `#ui`,
`#sand-canvas` and `#fluid-canvas`. Not debounced, not rAF-batched. On mobile
`resize` fires on every URL-bar show/hide and on soft-keyboard open — and
`deviceorientation` fires *continuously* while the device is tilted, at up to 60Hz,
running this whole read/write cycle each time. That is style invalidation on three
elements, one of which is a WebGL canvas, on the orientation-sensor cadence.

Note it also assigns `element.style = "…"`, i.e. a whole-`cssText` replacement.
This is *not* a CSP problem — `/games/sandspiel/*` (`_headers:211-215`) has
`style-src 'self' 'sha256-…'` with no `'unsafe-inline'`, but `cssText` goes
through the CSSOM, which `style-src` does not gate, and that policy does not
enforce Trusted Types. It is only a perf problem: clobbering `cssText` discards
and reparses the element's whole inline declaration block instead of touching the
two properties that changed.

**Fix:** (a) drop the `deviceorientation` listener entirely — `resize` and
`orientationchange` already cover every case that changes layout; tilt does not.
(b) coalesce the remaining handler into a single `requestAnimationFrame`, and read
`innerWidth`/`innerHeight` once each into locals. (c) write individual properties
via `style.setProperty` instead of clobbering `cssText`. The same
`deviceorientation` note applies to the fluid module's cached-rect handler at
`86.js@18913`.

### SS-7 — non-passive `touchmove` on `#background` purely to `preventDefault` (LOW)

`games/sandspiel/86.e096e8a7eaac6b8de58d.js@46327`

```js
document.getElementById("background").addEventListener("touchmove",function(e){
  window.paused||e.cancelable&&e.preventDefault()})
```

plus the same pattern on the canvases at `86.js@19140` (explicit `!1` third arg)
and `86.js@51368`. `games/sandspiel/styles.css:24-29` sets
`overscroll-behavior-x/y: none` but **no `touch-action`**, so JS is doing the
scroll suppression and the compositor blocks on it for every touch move.

**Fix:** add `touch-action: none` to `#background` and both canvases in
`styles.css`, then register the `touchmove` listeners `{ passive: true }` and drop
the `preventDefault`. Note the handler is already conditional on `window.paused`,
so its current behaviour is inconsistent anyway (scrolling is permitted while
paused) — the CSS approach makes it uniform.

### SS-8 — `setInterval(…, 100)` hold-to-paint, restarted on every move event (LOW)

`games/sandspiel/86.e096e8a7eaac6b8de58d.js@50485`

```js
function x(e){ clearInterval(m), m=window.setInterval(function(){return h(e)},100); ... }
```

and again at `86.js@50847` on `mousedown`. A timer, not rAF, so the repeat-paint
tick is not aligned to the frame and can land mid-frame. Primarily a desktop path,
but as established in SS-3 single-finger `touchmove` routes through `x` too — so on
mobile the interval is torn down and recreated on **every** touchmove event, and it
closes over the `Touch` object (retaining it until the next clear).

**Fix:** replace the interval with an rAF-driven repeat that checks elapsed time,
and stop recreating it inside `x` — set it once on `pointerdown`, clear once on
`pointerup`/`touchend`.

---

## 4. Cross-game

### XG-1 — `mj-mute.js` MutationObserver sweeps every added subtree (LOW-MED)

`games/mj-mute.js:50-61`

```js
new MutationObserver(function (muts) {
  ... if (node.tagName === 'AUDIO' || node.tagName === 'VIDEO') forceMute(node);
      else sweep(node);
}).observe(document.documentElement, { childList: true, subtree: true });
```

`sweep` (`mj-mute.js:44-47`) runs `querySelectorAll('audio, video')` over each
added subtree. Loaded first in all three games (`2048/index.html:7`,
`tiny-platformer/index.html:4`, `sandspiel/index.html:4`) but **inert unless the
URL carries `?mjmute=1`** (`mj-mute.js:8`), so it only costs anything when the
visitor chose to keep the catalog music playing.

Where it costs most is sandspiel: React commits add subtrees, and each one
triggers a fresh `querySelectorAll`. 2048 also adds up to 16 nodes per move
(T48-1), each triggering a `sweep`. Neither game ever creates an `<audio>` or
`<video>` element — the observer can never fire usefully in any of the three.

**Fix:** none of the three vendored games use media elements, so the observer is
dead weight for all of them. Either gate it behind a per-game opt-in flag, or keep
the one-shot `sweep(document)` at `mj-mute.js:49` and drop the observer. The
`HTMLMediaElement.prototype` and `AudioContext` patching (`mj-mute.js:14-40`,
`:67-88`) is where the actual protection lives and costs nothing at runtime — keep
all of it.

---

## Ranked summary

| # | Game | Impact | Finding | Evidence |
|---|------|--------|---------|----------|
| TP-1 | tiny-platformer | HIGH | 2048×1536 backing store for a 512×384 CSS box | `platformer.js:67-68`, `platformer.css:2-3` |
| TP-2 | tiny-platformer | HIGH | 3072 `fillRect`s/frame for a static map | `platformer.js:252-263` |
| SS-1 | sandspiel | HIGH | blocking per-frame `readPixels` on all Apple devices | `86.js@23047`, `@12251` |
| SS-2 | sandspiel | HIGH | sand canvas at 300×`ceil(dpr)` for a 300-cell pixelated sim | `86.js@46226` vs `@12400` |
| SS-3 | sandspiel | HIGH | `getBoundingClientRect` per interpolation step, ≤1000/event | `86.js@51589`, `@50500` |
| TP-3 | tiny-platformer | MED | no touch input at all; loop runs regardless | `platformer.js:372-373` |
| TP-4 | tiny-platformer | MED | 2D context without `alpha: false` | `platformer.js:66` |
| SS-4 | sandspiel | MED | 326KB React vendor bundle for a button row | `931.js`, `931.js.LICENSE.txt` |
| SS-5 | sandspiel | MED | 3 `Uint8Array` views allocated per frame | `86.js@19900` |
| SS-6 | sandspiel | MED | undebounced resize + `deviceorientation` layout read/write | `86.js@9350`, `@10130` |
| T48-1 | 2048 | MED | tile layer rebuilt per move + nested rAF reflow | `html_actuator.js:13-36,49-91` |
| T48-2 | 2048 | MED | 9 blocking scripts, 3 dead polyfills | `2048/index.html:87-96` |
| TP-5 | tiny-platformer | LOW-MED | accumulator can run 60 steps after a stall | `platformer.js:359-370` |
| T48-3 | 2048 | LOW-MED | synchronous `localStorage` write per move | `game_manager.js:79-96` |
| T48-4 | 2048 | LOW-MED | non-passive touch listeners duplicating `touch-action: none` | `keyboard_input_manager.js:80-99` |
| XG-1 | all three | LOW-MED | `mj-mute` observer sweeps every added subtree | `mj-mute.js:50-61` |
| SS-7 | sandspiel | LOW | non-passive `touchmove` with no `touch-action` in CSS | `86.js@46327`, `styles.css:24-29` |
| SS-8 | sandspiel | LOW | `setInterval` hold-paint recreated per touchmove | `86.js@50485` |
| TP-6 | tiny-platformer | LOW | fixed 512px floor overflows narrow viewports | `platformer.css:2,6` |
| T48-5 | 2048 | LOW | score container rebuilt per move | `html_actuator.js:106-121` |

### Suggested order of work, if any of this is picked up

1. **SS-3** — pure layout-thrash removal, no behaviour change, biggest
   effort-to-payoff ratio in the whole audit.
2. **TP-1 + TP-2 together** — they share the resize plumbing, and TP-2 is
   meaningless without TP-1's real CSS box size.
3. **SS-2** — one line, but needs a retina device to confirm the two canvas layers
   stay aligned.
4. **T48-2, SS-4(b), SS-6, SS-5, TP-4, TP-5** — small independent wins.
5. **SS-1** — highest raw impact on iPhone but the only finding that changes how
   the game *feels*; needs Matthew's sign-off and real-device measurement.
6. **TP-3** — a product decision (add touch controls, or don't ship it to phones),
   not a perf fix.

## Verification notes / limits of this audit

- Everything above is **static reading only**. No profile was captured, no device
  was measured, and no numbers here are observed — the impact ratings are
  reasoned from code structure (fill area, allocation counts, forced-layout
  counts), not from a trace.
- Sandspiel's two app bundles are minified to a single line each, so its evidence
  is cited as byte offsets into `86.e096e8a7eaac6b8de58d.js` /
  `931.ef9519c080d98187b4b3.js` rather than line numbers. Offsets were taken with
  `grep -bo` against the committed files and will shift if the bundles are ever
  rebuilt.
- The wasm module was not disassembled. SS-1, SS-2 and SS-5 all concern the JS
  glue that feeds it; the sim itself is treated as a black box, as instructed.
- What could **not** be established statically: the real cost of SS-1 on a given
  iPhone (depends entirely on the GPU's readback latency), whether SS-2 introduces
  any visible seam between the two canvas layers, and whether T48-4's passive
  conversion holds up on iOS Safari's swipe handling. All three need a device.
- Confirmed *not* a problem, having checked: the overlay creates and destroys the
  iframe per open (built at `script.js:907-908` / `:959`, torn down at `:937` and
  `:999`), so none of these rAF loops keeps
  running in the background after the visitor closes a game.
- Floppybird was deliberately excluded and not read.
