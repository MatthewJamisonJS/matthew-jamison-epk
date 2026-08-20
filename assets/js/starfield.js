/* <star-field> — original pixel-art starfield, seamless vertical loop.
   Palette matches the EPK (#600675 / #8B1FA8 on #0a0a0a).
   Hugo drop-in: include this script, place <star-field> absolutely inside your hero.
   Attributes: speed (default 1), density (default 1), nebulae (default 1).
   Honors prefers-reduced-motion (renders a still frame). MIT. */
(function () {
  'use strict';
  var TAG = 'star-field';
  if (customElements.get(TAG)) return;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var BG = '#0a0a0a';
  var FAR_COLORS = ['#4e4866', '#635b82', '#7d739e'];
  var MID_COLORS = ['#a89ec4', '#cbb3e0', '#e8e8e8'];
  var NEB_PURPLE = ['#160a1f', '#2c0f3d', '#600675', '#8B1FA8', '#c86fe0'];
  var NEB_MAGENTA = ['#1c0a24', '#3a0d4e', '#8B1FA8', '#b44ecf', '#e39af2'];
  var NEB_GREEN = ['#0e1a12', '#1c3324', '#3d6b4c', '#5BA36C', '#9ed0ab'];

  var PX = 4;            // css px per buffer px (the "pixel" size)
  var SPEEDS = { far: 3.2, mid: 6.0, near: 10.5 }; // buffer px / sec

  function drawStar(ctx, x, y, level, color, core) {
    if (level <= 0) { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); return; }
    ctx.fillStyle = color;
    if (level === 1) {
      ctx.fillRect(x, y - 1, 1, 3);
      ctx.fillRect(x - 1, y, 3, 1);
    } else {
      ctx.fillRect(x, y - 2, 1, 5);
      ctx.fillRect(x - 2, y, 5, 1);
      ctx.fillStyle = core || '#ffffff';
      ctx.fillRect(x, y, 1, 1);
    }
  }

  function makeStars(rng, count, T, W, periods) {
    var out = [];
    for (var i = 0; i < count; i++) {
      out.push({
        x: (rng() * W) | 0,
        y: (rng() * T) | 0,
        c: (rng() * 3) | 0,
        phase: rng(),
        period: periods[(rng() * periods.length) | 0]
      });
    }
    return out;
  }

  function paintBlob(ctx, rng, W, T, pal) {
    var cx = (rng() * W) | 0;
    var cy = (rng() * T) | 0;
    var walks = 2 + ((rng() * 3) | 0);
    var pts = [];
    for (var w = 0; w < walks; w++) {
      var x = cx + ((rng() * 8) | 0) - 4;
      var y = cy + ((rng() * 8) | 0) - 4;
      var steps = 26 + ((rng() * 46) | 0);
      for (var i = 0; i < steps; i++) {
        x += ((rng() * 3) | 0) - 1;
        y += ((rng() * 3) | 0) - 1;
        pts.push([x, y]);
      }
    }
    // painter helper: repeat at y-T and y+T so blobs tile seamlessly across the wrap edge
    function plot(px, py, s, color) {
      ctx.fillStyle = color;
      ctx.fillRect(px, py, s, s);
      ctx.fillRect(px, py - T, s, s);
      ctx.fillRect(px, py + T, s, s);
    }
    var j;
    for (j = 0; j < pts.length; j++) plot(pts[j][0] - 1, pts[j][1] - 1, 3, pal[0]);
    for (j = 0; j < pts.length; j++) if (j % 2 === 0) plot(pts[j][0], pts[j][1], 2, pal[1]);
    for (j = 0; j < pts.length; j++) if (j % 3 === 0) plot(pts[j][0], pts[j][1], 1, pal[2]);
    for (j = 0; j < pts.length; j++) if (j % 9 === 0) plot(pts[j][0], pts[j][1], 1, pal[3]);
    for (j = 0; j < pts.length; j++) if (j % 23 === 0) plot(pts[j][0], pts[j][1], 1, pal[4]);
  }

  var StarField = /** @class */ (function () {
    function F() { return Reflect.construct(HTMLElement, [], F); }
    F.prototype = Object.create(HTMLElement.prototype, { constructor: { value: F } });
    Object.setPrototypeOf(F, HTMLElement);

    F.observedAttributes = ['speed', 'density', 'nebulae'];

    F.prototype.connectedCallback = function () {
      if (this._init) { this._kick(); return; }
      this._init = true;
      if (!this.style.display) this.style.display = 'block';
      var c = document.createElement('canvas');
      c.style.cssText = 'width:100%;height:100%;display:block;image-rendering:pixelated;';
      c.setAttribute('aria-hidden', 'true');
      this.appendChild(c);
      this._c = c;
      // opaque context: every pixel is repainted each frame, so skip alpha blending
      this._ctx = c.getContext('2d', { alpha: false });
      this._t0 = performance.now();
      this._last = 0;
      this._visible = true;
      this._scrolling = false;
      var self = this;
      this._mq = matchMedia('(prefers-reduced-motion: reduce)');
      // take the size from the observer entry: reading clientWidth here would
      // force a synchronous layout on every resize
      this._ro = new ResizeObserver(function (entries) {
        var r = entries && entries[0] && entries[0].contentRect;
        self._resize(r && r.width, r && r.height);
      });
      this._ro.observe(this);
      this._io = new IntersectionObserver(function (e) {
        self._visible = e[0].isIntersecting;
        self._kick();
      });
      this._io.observe(this);
      this._onVis = function () { self._kick(); };
      document.addEventListener('visibilitychange', this._onVis);
      // thin the sky out while the page is scrolling rather than freezing it:
      // half the frame rate and the two cheapest layers dropped, so the scroll
      // thread stays clear but the stars keep falling. Trailing edge restores
      // the full sky.
      this._onScroll = function () {
        self._scrolling = true;
        clearTimeout(self._scrollT);
        self._scrollT = setTimeout(function () { self._scrolling = false; }, 260);
      };
      window.addEventListener('scroll', this._onScroll, { passive: true });
      // no _resize() call here: observe() fires the callback once on its own,
      // and letting it deliver the first size avoids a synchronous layout read
      // during element upgrade. The .page-orb fallback covers the one frame.
    };

    F.prototype.disconnectedCallback = function () {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      if (this._ro) this._ro.disconnect();
      if (this._io) this._io.disconnect();
      document.removeEventListener('visibilitychange', this._onVis);
      window.removeEventListener('scroll', this._onScroll);
      clearTimeout(this._scrollT);
    };

    F.prototype.attributeChangedCallback = function () {
      if (this._init && this._W) { this._build(); this._kick(); }
    };

    F.prototype._num = function (name, dflt) {
      var v = parseFloat(this.getAttribute(name));
      return isFinite(v) ? v : dflt;
    };

    // lean mode: small viewport or the user asked the browser to save data
    F.prototype._lean = function () {
      var conn = navigator.connection || navigator.webkitConnection || {};
      return window.innerWidth < 640 || conn.saveData === true;   // phones lean, tablets get the full sky
    };

    F.prototype._resize = function (w, h) {
      // w/h come from the ResizeObserver entry; measuring is the fallback for
      // an entry without a contentRect (older engines)
      if (!w || !h) { w = this.clientWidth; h = this.clientHeight; }
      if (!w || !h) return;
      this._W = Math.max(32, Math.round(w / PX));
      this._H = Math.max(32, Math.round(h / PX));
      this._T = this._H + 96; // tile height: buffer + headroom so wrap is invisible
      this._c.width = this._W;
      this._c.height = this._H;
      this._build();
      this._kick();
    };

    F.prototype._build = function () {
      var W = this._W, T = this._T;
      var lean = this._lean();
      var d = this._num('density', 1) * (lean ? 0.6 : 1);
      var neb = this._num('nebulae', 1) * (lean ? 0.7 : 1);
      this._spBudget = lean ? 0.7 : 1;
      var rng = mulberry32(404); // deterministic — same sky every load
      this._far = makeStars(rng, Math.round(W * T / 220 * d), T, W, [4, 8]);
      this._mid = makeStars(rng, Math.round(W * T / 480 * d), T, W, [2, 4, 8]);
      this._near = makeStars(rng, Math.round(W * T / 2400 * d), T, W, [2, 4]);
      // prerender nebula tile
      var tile = document.createElement('canvas');
      tile.width = W; tile.height = T;
      var tctx = tile.getContext('2d');
      var count = Math.max(0, Math.round(W * T / 5200 * neb));
      for (var i = 0; i < count; i++) {
        var roll = rng();
        var pal = roll < 0.6 ? NEB_PURPLE : roll < 0.88 ? NEB_MAGENTA : NEB_GREEN;
        paintBlob(tctx, rng, W, T, pal);
      }
      this._tile = tile;
    };

    F.prototype._drawLayer = function (stars, off, colors, tier, t) {
      var ctx = this._ctx, T = this._T, H = this._H;
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        var y = (s.y + off) % T;
        if (y >= H + 4) continue;
        var tw = (Math.sin(2 * Math.PI * (t / s.period + s.phase)) + 1) / 2;
        var level;
        if (tier === 0) level = 0;
        else if (tier === 1) level = tw > 0.72 ? 1 : 0;
        else level = tw > 0.6 ? 2 : 1;
        var color = colors[s.c];
        if (tier === 2 && s.c === 0) color = '#8B1FA8';
        if (tier === 2 && s.phase < 0.06) color = '#5BA36C';
        drawStar(ctx, s.x, y | 0, level, color, '#ffffff');
      }
    };

    F.prototype._draw = function (t) {
      var ctx = this._ctx, W = this._W, H = this._H, T = this._T;
      if (!W) return;
      var sp = this._num('speed', 1) * (this._spBudget || 1);
      var lean = this._scrolling;   // scrolling: cheapest work that still moves
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);
      var midOff = (t * SPEEDS.mid * sp) % T;
      if (!lean) {
        // nebulae ride the mid layer — two full-canvas blits, the priciest
        // thing here, so they sit out the scroll
        ctx.drawImage(this._tile, 0, midOff - T);
        ctx.drawImage(this._tile, 0, midOff);
      }
      this._drawLayer(this._far, (t * SPEEDS.far * sp) % T, FAR_COLORS, 0, t);
      this._drawLayer(this._mid, midOff, MID_COLORS, 1, t);
      // every layer advances off the same `t`, so nothing jumps when lean lifts
      if (!lean) {
        this._drawLayer(this._near, (t * SPEEDS.near * sp) % T, MID_COLORS, 2, t);
      }
    };

    F.prototype._kick = function () {
      var self = this;
      cancelAnimationFrame(this._raf);
      var step = function (now) {
        self._raf = requestAnimationFrame(step);   // reschedule first: a skipped frame must not end the loop
        // ~30fps is plenty for pixel art; ~20fps while scrolling
        if (now - self._last < (self._scrolling ? 50 : 33)) return;
        self._last = now;
        self._draw((now - self._t0) / 1000);
        if (self._mq.matches || !self._visible || document.hidden) {
          cancelAnimationFrame(self._raf);        // one still frame, then stop
          self._raf = 0;
        }
      };
      this._raf = requestAnimationFrame(step);
    };

    return F;
  })();

  customElements.define(TAG, StarField);
})();
