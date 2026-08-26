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
