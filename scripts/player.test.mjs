// scripts/player.test.mjs — behavioural tests for player.js.
//
// player.js is an IIFE with no exports, so there is nothing to import. It is
// evaluated inside a node:vm context against a hand-rolled stub environment and
// observed through the stubs: which src an element was given, whether play()
// was called, what fetch was asked for, what landed in the fake IndexedDB and
// localStorage. Zero dependencies — node:test, node:assert, node:vm, node:fs.
//
// The static shape of the file (no globals, no innerHTML, bar parity) is
// covered by scripts/build.test.mjs. What lives here is the decision logic a
// scan cannot see: the source-resolution table, the synchronous ended → src →
// play() rule, the handoff target, the prefetch window and its LRU eviction,
// the soft-offline backoff and the resume bookmark.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, '..', 'player.js'), 'utf8');
const API = 'https://api.matthewjamison.dev';

const ALBUM = '{"alb":{"t":"alb","k":"album","p":"$9.99","tr":[[1,"one",100],[2,"two",100],[3,"three",100]]}}';
const PACK = '{"pack":{"t":"pack","k":"sample pack","p":"$5.99","tr":[[1,"loop",30]]}}';

const MB = 1024 * 1024;

// ── stub DOM ────────────────────────────────────────────────────────────────

function makeClassList() {
  const set = new Set();
  return {
    _set: set,
    add: n => { set.add(n); },
    remove: n => { set.delete(n); },
    contains: n => set.has(n),
    toggle: (n, force) => {
      const on = force === undefined ? !set.has(n) : !!force;
      if (on) set.add(n); else set.delete(n);
      return on;
    }
  };
}

class El {
  constructor(name, w) {
    this.name = name;
    this._w = w;
    this._attrs = new Map();
    this._listeners = new Map();
    this.classList = makeClassList();
    this.dataset = {};
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.offsetHeight = 40;
    const props = new Map();
    this.style = {
      _props: props,
      setProperty: (k, v) => { props.set(k, v); },
      removeProperty: k => { props.delete(k); }
    };
  }
  get attributes() {
    return Array.from(this._attrs, ([name, value]) => ({ name, value }));
  }
  getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
  setAttribute(n, v) { this._attrs.set(n, String(v)); }
  removeAttribute(n) { this._attrs.delete(n); }
  hasAttribute(n) { return this._attrs.has(n); }
  addEventListener(type, fn, opts) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push({ fn, once: !!(opts && opts.once) });
  }
  removeEventListener(type, fn) {
    const list = this._listeners.get(type);
    if (!list) return;
    const i = list.findIndex(l => l.fn === fn);
    if (i !== -1) list.splice(i, 1);
  }
  dispatchEvent(ev) {
    if (!ev.target) ev.target = this;
    const list = this._listeners.get(ev.type);
    if (!list) return true;
    for (const l of list.slice()) {
      if (l.once) this.removeEventListener(ev.type, l.fn);
      l.fn(ev);
    }
    return true;
  }
  // every selector player.js hands closest() is a single class
  closest(sel) {
    return this.classList.contains(sel.replace(/^\./, '')) ? this : null;
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  after(el) { this._w.afterCalls.push([this.name, el.name]); }
  remove() { this._w.removed.push(this.name); }
}

class AudioEl extends El {
  constructor(name, w) {
    super(name, w);
    this.srcHistory = [];
    this.plays = [];
    this.loads = 0;
    this.currentTime = 0;
    this.duration = NaN;
    this.paused = true;
    this.readyState = 0;
    this.preload = 'none';
    this.muted = false;
    this.currentSrc = '';
    this.buffered = { length: 0, start: () => 0, end: () => 0 };
    w.audioEls.push(this);
  }
  get src() { return this.getAttribute('src') || ''; }
  set src(v) {
    const s = String(v);
    this.setAttribute('src', s);
    this.currentSrc = s;
    this.srcHistory.push(s);
    this._w.srcLog.push({ el: this.name, src: s, at: this._w.clock.now });
  }
  play() {
    this.paused = false;
    this.plays.push(this._w.clock.now);
    this._w.playLog.push(this.name);
    this.dispatchEvent({ type: 'play' });
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent({ type: 'pause' });
  }
  load() { this.loads++; }
  canPlayType(t) { return this._w.canPlay(t); }
}

// ── fake IndexedDB ──────────────────────────────────────────────────────────
//
// Exactly the surface player.js touches: open + onupgradeneeded/onsuccess,
// createObjectStore, objectStoreNames.contains, transaction(name, mode) with
// get/put/count/delete/openCursor, and oncomplete/onerror/onabort. Requests
// fire on a microtask; a transaction completes once every request it spawned
// (cursor continues included) has drained.
function makeIdb(w) {
  const tracks = new Map();
  let created = false;

  function maybeDone(tx) {
    if (tx.dead || tx.done || tx.pending > 0) return;
    tx.done = true;
    queueMicrotask(() => { if (!tx.dead && tx.oncomplete) tx.oncomplete(); });
  }
  function sched(tx, fn) {
    tx.pending++;
    queueMicrotask(() => {
      if (!tx.dead) fn();
      tx.pending--;
      maybeDone(tx);
    });
  }
  function storeApi(tx) {
    return {
      get(key) {
        const req = { result: undefined, onsuccess: null, onerror: null };
        sched(tx, () => { req.result = tracks.get(key); if (req.onsuccess) req.onsuccess(); });
        return req;
      },
      put(value, key) {
        const req = { onsuccess: null, onerror: null, error: null };
        sched(tx, () => {
          if (idb.quotaOnce) {
            idb.quotaOnce = false;
            req.error = { name: 'QuotaExceededError' };
            if (req.onerror) req.onerror();
            tx.abort();
            return;
          }
          tracks.set(key, value);
          if (req.onsuccess) req.onsuccess();
        });
        return req;
      },
      count(key) {
        const req = { result: 0, onsuccess: null, onerror: null };
        sched(tx, () => { req.result = tracks.has(key) ? 1 : 0; if (req.onsuccess) req.onsuccess(); });
        return req;
      },
      delete(key) {
        const req = { onsuccess: null, onerror: null };
        sched(tx, () => { tracks.delete(key); if (req.onsuccess) req.onsuccess(); });
        return req;
      },
      openCursor() {
        const req = { result: null, onsuccess: null, onerror: null };
        const keys = Array.from(tracks.keys());
        let i = 0;
        const step = () => {
          if (i >= keys.length) {
            req.result = null;
            if (req.onsuccess) req.onsuccess();
            return;
          }
          const k = keys[i++];
          req.result = { key: k, value: tracks.get(k), continue: () => sched(tx, step) };
          if (req.onsuccess) req.onsuccess();
        };
        sched(tx, step);
        return req;
      }
    };
  }
  const db = {
    objectStoreNames: { contains: n => created && n === 'tracks' },
    createObjectStore(n) { if (n === 'tracks') created = true; return storeApi({ pending: 0 }); },
    transaction() {
      const tx = { oncomplete: null, onerror: null, onabort: null, pending: 0, dead: false, done: false };
      tx.abort = () => {
        if (tx.dead) return;
        tx.dead = true;
        if (tx.onabort) tx.onabort();
      };
      tx.objectStore = () => storeApi(tx);
      queueMicrotask(() => maybeDone(tx));
      return tx;
    }
  };
  const idb = {
    tracks,
    quotaOnce: false,
    open() {
      const req = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      queueMicrotask(() => {
        req.result = db;
        if (!created && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    }
  };
  w.idb = idb;
  return idb;
}

// ── fake clock ──────────────────────────────────────────────────────────────
//
// player.js calls setTimeout/clearTimeout/Date.now unqualified (verified: it
// never says window.setTimeout or globalThis.*), so shimming them on the vm
// global is enough and makes the backoff deterministic.
function makeClock(w) {
  const timers = new Map();
  let seq = 1;
  const clock = {
    now: 1000000,
    timers,
    set(fn, ms) {
      const id = seq++;
      timers.set(id, { id, at: clock.now + (Number(ms) || 0), fn });
      return id;
    },
    clear(id) { timers.delete(id); },
    run(ms) {
      const target = clock.now + ms;
      for (;;) {
        let next = null;
        for (const t of timers.values()) {
          if (t.at > target) continue;
          if (!next || t.at < next.at || (t.at === next.at && t.id < next.id)) next = t;
        }
        if (!next) break;
        timers.delete(next.id);
        if (next.at > clock.now) clock.now = next.at;
        next.fn();
      }
      clock.now = target;
    }
  };
  return clock;
}

function abortErr() {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

// ── the world ───────────────────────────────────────────────────────────────

const BAR_IDS = [
  'store-player-art', 'store-player-release', 'store-player-track',
  'store-prev', 'store-toggle', 'store-next', 'store-stop',
  'store-scrub', 'store-time', 'store-quality',
  'store-quality-mode', 'store-quality-now'
];

function makeWorld(opts = {}) {
  const w = {};

  w.clock = makeClock(w);
  w.audioEls = [];
  w.srcLog = [];
  w.playLog = [];
  w.afterCalls = [];
  w.removed = [];
  w.fetches = [];
  w.objectUrls = [];
  w.revoked = [];
  w.rafs = [];
  w.blobSize = 4 * MB;
  w.fetchAdvance = 0;
  w.onFetch = opts.onFetch || null;
  w.canPlay = t => (opts.canFlac === false ? '' : (/flac/.test(t) ? 'probably' : 'maybe'));

  // elements
  const els = new Map();
  const mk = (id, Cls) => {
    const el = new (Cls || El)(id, w);
    el.id = id;
    el.setAttribute('id', id);
    els.set(id, el);
    return el;
  };

  const data = mk('store-data');
  data.textContent = opts.catalog === undefined ? ALBUM : opts.catalog;
  const bar = mk('store-player');
  bar.hidden = true;
  const audio = mk('store-audio', AudioEl);
  audio.setAttribute('preload', 'none');
  const statusEl = mk('store-status');
  statusEl.offsetHeight = 20;
  BAR_IDS.forEach(id => mk(id));
  const toggle = els.get('store-toggle');
  toggle.classList.add('is-playing');
  toggle.setAttribute('aria-label', 'pause playback');

  w.els = els;
  w.audio = audio;
  w.bar = bar;
  w.status = statusEl;

  const body = new El('body', w);
  const document = new El('document', w);
  document.body = body;
  document.getElementById = id => (els.has(id) ? els.get(id) : null);
  document.createElement = tag => {
    const el = tag === 'audio' ? new AudioEl('aud' + w.audioEls.length, w) : new El(tag, w);
    return el;
  };
  document.querySelector = sel => (w.onQuery ? w.onQuery(sel) : null);
  document.querySelectorAll = () => [];
  w.document = document;
  w.body = body;

  const win = new El('window', w);
  win.location = { href: '' };
  win.MediaMetadata = class MediaMetadata {
    constructor(d) { Object.assign(this, d); }
  };
  w.window = win;

  const store = new Map(Object.entries(opts.storage || {}));
  w.storage = store;
  w.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); }
  };

  w.navigator = {
    onLine: opts.onLine === undefined ? true : opts.onLine,
    connection: opts.connection,
    storage: { persist: () => Promise.resolve(true) },
    mediaSession: {
      playbackState: 'none',
      metadata: null,
      setActionHandler() {}
    }
  };

  let urlSeq = 0;
  w.URL = {
    createObjectURL: blob => {
      const u = 'blob:test/' + (urlSeq++);
      w.objectUrls.push({ url: u, blob });
      return u;
    },
    revokeObjectURL: u => { w.revoked.push(u); }
  };

  w.indexedDB = makeIdb(w);
  w.AbortController = AbortController;
  w.setTimeout = (fn, ms) => w.clock.set(fn, ms);
  w.clearTimeout = id => w.clock.clear(id);
  w.requestAnimationFrame = fn => { w.rafs.push(fn); return w.rafs.length; };
  w.Date = { now: () => w.clock.now };
  w.console = console;

  w.fetch = (url, options) => {
    const rec = { url: String(url), opts: options, at: w.clock.now };
    w.fetches.push(rec);
    w.clock.now += w.fetchAdvance;
    const signal = options && options.signal;
    if (signal && signal.aborted) return Promise.reject(abortErr());
    const planned = w.onFetch ? w.onFetch(rec, w.fetches.length - 1, w) : null;
    const p = planned || Promise.resolve({
      ok: true,
      status: 200,
      blob: () => Promise.resolve({ size: w.blobSize })
    });
    if (!signal) return p;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortErr());
      signal.addEventListener('abort', onAbort, { once: true });
      p.then(
        v => { signal.removeEventListener('abort', onAbort); resolve(v); },
        e => { signal.removeEventListener('abort', onAbort); reject(e); }
      );
    });
  };

  return w;
}

function boot(opts = {}) {
  const w = makeWorld(opts);
  const ctx = vm.createContext(w);
  // the realm's own TypeError: fetchTrack does `err instanceof TypeError`, and a
  // TypeError minted out here belongs to a different realm and would not match.
  w.RealmTypeError = vm.runInContext('TypeError', ctx);
  vm.runInContext(SRC, ctx, { filename: 'player.js' });
  w.probe = w.audioEls[1];
  w.standby = w.audioEls[w.audioEls.length - 1];
  return w;
}

async function flush(turns = 60) {
  for (let i = 0; i < turns; i++) await new Promise(r => setImmediate(r));
}

async function tick(w, ms) {
  w.clock.run(ms);
  await flush();
}

// a synthetic control. Real buttons carry .store-play, and a tracklist row's
// button carries both .store-play and .track-play — closest() is all the
// delegated listener reads, so a bare stub with the right classes is enough.
function button(w, classes, data) {
  const b = new El('btn', w);
  classes.forEach(c => b.classList.add(c));
  Object.assign(b.dataset, data);
  return b;
}

function clickRelease(w, slug) {
  w.document.dispatchEvent({ type: 'click', target: button(w, ['store-play'], { slug }) });
}

function clickTrack(w, slug, nn) {
  w.document.dispatchEvent({
    type: 'click',
    target: button(w, ['store-play', 'track-play'], { slug, track: nn })
  });
}

function firstSrc(w) { return w.srcLog.length ? w.srcLog[0].src : null; }
function lastSrc(w) { return w.srcLog.length ? w.srcLog[w.srcLog.length - 1].src : null; }
function seed(w, key, size) { w.idb.tracks.set(key, { blob: { size: size || 4 * MB }, bytes: size || 4 * MB, at: 1 }); }
function state(w) { return w.storage.get('mj-player-state'); }

// ── 1. boot ─────────────────────────────────────────────────────────────────

test('boot is quiet: two elements, disabled ends, idle toggle label', () => {
  const w = boot();
  assert.equal(w.afterCalls.length, 1, 'the standby element is inserted after the primary');
  assert.deepEqual(w.afterCalls[0], ['store-audio', w.standby.name]);
  assert.equal(w.audioEls.length, 3, 'primary + flac probe + standby');
  assert.equal(w.els.get('store-toggle').getAttribute('aria-label'), 'resume playback');
  assert.equal(w.els.get('store-toggle').classList.contains('is-playing'), false);
  assert.equal(w.els.get('store-prev').disabled, true);
  assert.equal(w.els.get('store-next').disabled, true);
  assert.equal(w.bar.hidden, true);
  assert.equal(w.srcLog.length, 0, 'nothing is loaded at boot');
  assert.equal(w.playLog.length, 0);
});

test('a page with no player markup returns without touching anything', () => {
  const w = makeWorld();
  w.els.delete('store-player');
  const ctx = vm.createContext(w);
  vm.runInContext(SRC, ctx, { filename: 'player.js' });
  assert.equal(w.afterCalls.length, 0);
});

// ── 2. the source-resolution table ──────────────────────────────────────────

test('source table: auto + flac → /s/', async () => {
  const w = boot();
  clickRelease(w, 'alb');
  assert.equal(firstSrc(w), API + '/s/alb/01');
});

test('source table: saver → /p/', async () => {
  const w = boot({ storage: { 'mj-stream-quality': 'saver' } });
  clickRelease(w, 'alb');
  assert.equal(firstSrc(w), API + '/p/alb/01');
});

test('source table: saver + vaulted → blob:', async () => {
  const w = boot({ storage: { 'mj-stream-quality': 'saver' } });
  seed(w, 'alb/02');
  clickRelease(w, 'alb');          // track 1, nothing adopted yet → /p/
  await flush();                   // ensureWindow adopts alb/02 off the vault
  clickTrack(w, 'alb', '02');
  assert.match(lastSrc(w), /^blob:test\//);
});

test('source table: auto on a 3g link → /p/', async () => {
  const w = boot({ connection: { effectiveType: '3g' } });
  clickRelease(w, 'alb');
  assert.equal(firstSrc(w), API + '/p/alb/01');
});

test('source table: auto with saveData → /p/', async () => {
  const w = boot({ connection: { saveData: true, effectiveType: '4g' } });
  clickRelease(w, 'alb');
  assert.equal(firstSrc(w), API + '/p/alb/01');
});

test('source table: a sample pack is pinned to /p/ even in auto', async () => {
  const w = boot({ catalog: PACK });
  clickRelease(w, 'pack');
  assert.equal(firstSrc(w), API + '/p/pack/01');
});

test('source table: lossless asks for /s/ even with the link down', async () => {
  const w = boot({ storage: { 'mj-stream-quality': 'lossless' }, onLine: false });
  clickRelease(w, 'alb');
  assert.equal(firstSrc(w), API + '/s/alb/01');
});

test('source table: no flac decoder → /p/ in auto', async () => {
  const w = boot({ canFlac: false });
  clickRelease(w, 'alb');
  assert.equal(firstSrc(w), API + '/p/alb/01');
});

// ── 3. the synchronous boundary ─────────────────────────────────────────────

test('ended → src → play() is synchronous, off a prebuilt blob URL', async () => {
  // saver so the next track resolves to the vault rather than the flac stream
  const w = boot({ storage: { 'mj-stream-quality': 'saver' } });
  seed(w, 'alb/02');
  clickRelease(w, 'alb');
  await flush();                       // alb/02's blob: URL is adopted

  const before = w.playLog.length;
  const el = w.audio;
  el.dispatchEvent({ type: 'ended' });  // NO await between here and the asserts
  assert.match(el.src, /^blob:test\//, 'the src was assigned inside the handler');
  assert.equal(w.playLog.length, before + 1, 'play() was called inside the handler');
  assert.equal(w.playLog[w.playLog.length - 1], el.name);
  assert.equal(w.els.get('store-player-track').textContent, '02 / 3\u00a0\u00b7\u00a0two');
});

// ── 4. the prefetch window ──────────────────────────────────────────────────

test('prefetch window: three sequential /p/ fetches, all vaulted and adopted', async () => {
  const w = boot();
  clickRelease(w, 'alb');
  await flush();

  assert.deepEqual(w.fetches.map(f => f.url), [
    API + '/p/alb/01', API + '/p/alb/02', API + '/p/alb/03'
  ]);
  assert.deepEqual(Array.from(w.idb.tracks.keys()), ['alb/01', 'alb/02', 'alb/03']);
  assert.equal(w.objectUrls.length, 3);
  assert.equal(w.revoked.length, 0);
});

test('prefetch window slides: stepping to track 3 revokes track 1', async () => {
  const w = boot();
  clickRelease(w, 'alb');
  await flush();
  const first = w.objectUrls[0].url;

  clickTrack(w, 'alb', '03');
  await flush();
  assert.ok(w.revoked.includes(first), 'the URL for alb/01 fell out of the window');
  assert.equal(w.revoked.length, 2, 'alb/01 and alb/02 both left the window');
});

test('stop revokes every blob URL and tears the queue down', async () => {
  const w = boot();
  clickRelease(w, 'alb');
  await flush();
  const made = w.objectUrls.map(u => u.url);

  w.els.get('store-stop').dispatchEvent({ type: 'click' });
  await flush();
  made.forEach(u => assert.ok(w.revoked.includes(u), u + ' was revoked'));
  const after = w.fetches.length;
  await tick(w, 300000);
  assert.equal(w.fetches.length, after, 'nothing is left queued after stop');
  assert.equal(w.bar.hidden, true);
});

// ── 5. handoff target selection ─────────────────────────────────────────────

test('a stall hands off to the vault when the track is saved', async () => {
  const w = boot();
  seed(w, 'alb/01');
  clickRelease(w, 'alb');
  await flush();
  assert.equal(firstSrc(w), API + '/s/alb/01');

  w.audio.dispatchEvent({ type: 'waiting' });
  await tick(w, 2100);
  assert.match(w.standby.src, /^blob:test\//, 'the idle element loaded the saved copy');
});

test('a stall hands off to /p/ when the track is not saved', async () => {
  // the prefetch never lands, so nothing is adopted and the fallback is the stream
  const w = boot({ onFetch: () => new Promise(() => {}) });
  clickRelease(w, 'alb');
  await flush();
  assert.equal(firstSrc(w), API + '/s/alb/01');

  w.audio.dispatchEvent({ type: 'waiting' });
  await tick(w, 2100);
  assert.equal(w.standby.src, API + '/p/alb/01');
});

// ── 6. the soft offline backoff ─────────────────────────────────────────────

test('a failed fetch backs off 15s, then 30s, and a success resets it', async () => {
  const plan = ['fail', 'fail', 'ok', 'fail', 'ok'];
  const w = boot({
    onFetch: (rec, i, world) => {
      const how = plan[i] || 'ok';
      if (how === 'fail') return Promise.reject(new world.RealmTypeError('Failed to fetch'));
      return null;
    }
  });
  clickRelease(w, 'alb');
  await flush();
  assert.equal(w.fetches.length, 1, 'one attempt, then the queue holds');

  await tick(w, 14999);
  assert.equal(w.fetches.length, 1, 'nothing retries inside the window');
  await tick(w, 1);
  assert.equal(w.fetches.length, 2);
  assert.equal(w.fetches[1].at - w.fetches[0].at, 15000);

  await tick(w, 29999);
  assert.equal(w.fetches.length, 2, 'the second failure doubled the window');
  await tick(w, 1);
  assert.equal(w.fetches.length, 4, 'the retry succeeds and the queue rolls straight on');
  assert.equal(w.fetches[2].at - w.fetches[1].at, 30000);
  assert.equal(w.fetches[3].at, w.fetches[2].at, 'the next key goes out immediately');

  // fetch #4 failed again — a success reset the backoff, so this is 15s not 60s
  await tick(w, 14999);
  assert.equal(w.fetches.length, 4);
  await tick(w, 1);
  assert.equal(w.fetches.length, 6, 'that one succeeds and the last key follows it');
  assert.equal(w.fetches[4].at - w.fetches[3].at, 15000);
  assert.equal(w.fetches[5].at, w.fetches[4].at);
});

test('an offline event stops attempts until online comes back', async () => {
  const w = boot({
    onFetch: (rec, i, world) => Promise.reject(new world.RealmTypeError('Failed to fetch'))
  });
  clickRelease(w, 'alb');
  await flush();
  assert.equal(w.fetches.length, 1);

  w.window.dispatchEvent({ type: 'offline' });
  await tick(w, 600000);
  assert.equal(w.fetches.length, 1, 'the backoff clock is disarmed while the link is down');

  w.window.dispatchEvent({ type: 'online' });
  await flush();
  assert.equal(w.fetches.length, 2, 'online resumes the queue at once');
});

// ── 7. LRU eviction ─────────────────────────────────────────────────────────

test('the vault evicts the oldest entry once the cap is passed', async () => {
  const w = boot();
  w.blobSize = 80 * MB;    // 3 × 80MB = 240MB against a 200MiB cap
  w.fetchAdvance = 1000;   // distinct `at` clocks per put
  clickRelease(w, 'alb');
  await flush();

  assert.deepEqual(Array.from(w.idb.tracks.keys()), ['alb/02', 'alb/03']);
  const total = Array.from(w.idb.tracks.values()).reduce((n, r) => n + r.bytes, 0);
  assert.ok(total <= 200 * MB, 'back under the cap');
});

test('a QuotaExceededError evicts the coldest entry and the put is retried', async () => {
  const w = boot();
  seed(w, 'old/99', 1 * MB);
  w.idb.quotaOnce = true;
  clickRelease(w, 'alb');
  await flush();

  assert.equal(w.idb.tracks.has('old/99'), false, 'the coldest entry was dropped');
  assert.equal(w.idb.tracks.has('alb/01'), true, 'and the refused put went through on the retry');
});

// ── 8. the resume bookmark ──────────────────────────────────────────────────

test('timeupdate parks the position in localStorage', async () => {
  const w = boot();
  clickTrack(w, 'alb', '02');
  await flush();
  w.audio.readyState = 1;
  w.audio.currentTime = 42.3;
  w.audio.dispatchEvent({ type: 'timeupdate' });
  assert.equal(state(w), '{"v":1,"slug":"alb","index":1,"t":42.3}');
});

test('a saved bookmark boots the bar paused at that spot', async () => {
  const w = boot({
    storage: { 'mj-player-state': '{"v":1,"slug":"alb","index":1,"t":42.3}' }
  });
  assert.equal(firstSrc(w), API + '/s/alb/02', 'the source was loaded for the saved track');
  assert.equal(w.playLog.length, 0, 'and left paused');
  assert.equal(w.audio.preload, 'metadata');
  assert.equal(w.els.get('store-time').textContent, '0:42 / 1:40');
  assert.equal(w.bar.hidden, false);

  w.audio.duration = 100;
  w.audio.dispatchEvent({ type: 'loadedmetadata' });
  assert.equal(w.audio.currentTime, 42.3, 'the seek lands once metadata arrives');
});

test('a bookmark for another release is left alone', async () => {
  const raw = '{"v":1,"slug":"elsewhere","index":0,"t":10}';
  const w = boot({ storage: { 'mj-player-state': raw } });
  assert.equal(w.srcLog.length, 0, 'nothing loaded');
  assert.equal(state(w), raw, 'and the bookmark survives for the page that owns it');
});

test('a restored bar with no metadata yet does not overwrite its own bookmark', async () => {
  const raw = '{"v":1,"slug":"alb","index":1,"t":42.3}';
  const w = boot({ storage: { 'mj-player-state': raw } });
  assert.equal(w.audio.readyState, 0);
  w.window.dispatchEvent({ type: 'pagehide' });
  assert.equal(state(w), raw);
});

test('stop clears the bookmark', async () => {
  const w = boot();
  clickTrack(w, 'alb', '02');
  await flush();
  w.audio.readyState = 1;
  w.audio.currentTime = 12;
  w.audio.dispatchEvent({ type: 'timeupdate' });
  assert.ok(state(w));

  w.els.get('store-stop').dispatchEvent({ type: 'click' });
  assert.equal(state(w), undefined);
});

test('the end of the last track clears the bookmark', async () => {
  const w = boot();
  clickTrack(w, 'alb', '03');
  await flush();
  w.audio.readyState = 1;
  w.audio.currentTime = 99;
  w.audio.dispatchEvent({ type: 'timeupdate' });
  assert.ok(state(w));

  w.audio.dispatchEvent({ type: 'ended' });
  assert.equal(state(w), undefined);
  assert.equal(w.playLog.filter(n => n === w.audio.name).length, 1,
    'and nothing advanced past the end');
});

// ── 9. no leaks ─────────────────────────────────────────────────────────────

test('the IIFE adds no globals', () => {
  const w = makeWorld();
  const ctx = vm.createContext(w);
  const before = Object.keys(w).sort();
  vm.runInContext(SRC, ctx, { filename: 'player.js' });
  assert.deepEqual(Object.keys(w).sort(), before);
});
