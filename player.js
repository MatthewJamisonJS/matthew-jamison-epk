// player.js — the one player for / and every /music/<slug>/.
//
// One shared <audio> pair for the whole catalog, plus the Stripe checkout
// hand-off. Lifted wholesale out of script.js (the store IIFE) with release.js
// folded in: Media Session, the ⏮ restart rule and the tracklist row painting
// are the only things release.js had that the store player did not. The pages
// differ only in what their #store-data block holds — the full catalog on /,
// the single release on /music/<slug>/ — so there is one code path.
//
// play/pause are inline <svg> pairs baked into the markup; state is carried by
// an .is-playing class and CSS picks which of the two icons is displayed.
// Everything below builds DOM with createElement/textContent — the CSP has no
// 'unsafe-inline' and requires Trusted Types, so innerHTML is not available.
// Nothing here writes markup, and nothing is exposed on window.
(function () {
  const API = 'https://api.matthewjamison.dev';
  const RESTART_AFTER = 3;  // seconds into a track before ⏮ restarts it

  // full tracks stream lossless where the browser can decode FLAC (all
  // current engines); anything older falls back to the 128k MP3 previews.
  const probe = document.createElement('audio');
  const canFlac = !!(probe.canPlayType && probe.canPlayType('audio/flac'));

  // stream quality: auto (default) | lossless | saver. Resolved per track load
  // rather than once at boot — a connection can change mid-session.
  const QUALITY_KEY = 'mj-stream-quality';
  const MODES = ['auto', 'lossless', 'saver'];
  const NEXT_ACTION = {
    auto: 'press to force lossless',
    lossless: 'press to force data saver',
    saver: 'press to use automatic quality'
  };
  const STALL_BUDGET = 2000;  // ms of buffering before auto gives up on flac
  const START_DEADLINE = 2500;  // ms before an unstarted flac load falls back to mp3
  const RUNWAY_MIN = 3;      // seconds of buffer ahead of the playhead
  const RUNWAY_ENDGAME = 5;  // last seconds of a track: a shrinking runway is the end, not a stall
  const HEALTH_STREAK = 20000;   // ms of healthy mp3 playback before flac is even considered
  const COOLDOWN_BASE = 60000;   // ms after a demote before the first re-look
  const COOLDOWN_MAX = 480000;   // ms ceiling on the doubling backoff (8 min)
  const PROBE_BYTES = 524287;    // range end — 512 KiB of the flac source
  const PROBE_MIN_BPS = 2000000 / 8;  // 2 Mbps, in bytes per second
  const SAMPLE_EVERY = 5000;     // ms between passive health samples

  let mode = 'auto';
  try {
    const saved = localStorage.getItem(QUALITY_KEY);
    if (MODES.indexOf(saved) !== -1) mode = saved;
  } catch (e) { /* storage blocked — stay on auto */ }

  // auto gives up on flac fast and comes back slow. A demote is instant; the way
  // back needs a long healthy streak, a cooldown that doubles per demote, and a
  // measured probe — so a marginal connection can't flap between the two sources.
  let demoteCount = 0;
  let demotedAt = 0;
  let healthySince = 0;
  let promotable = false;
  let probing = false;

  function recordDemote() {
    demoteCount++;
    demotedAt = Date.now();
    promotable = false;
    healthySince = 0;
  }

  function slowLink() {
    const c = navigator.connection;
    if (!c) return false;
    if (c.saveData === true) return true;
    const et = c.effectiveType;
    return et === 'slow-2g' || et === '2g' || et === '3g';
  }

  // sample packs and the bundle ship preview clips only — there are no
  // stream/{slug} flac objects behind them, so /s/ would 404 for every mode.
  // They are pinned to the 128k /p/ path and sit outside the adaptive machine
  // entirely; music releases are unaffected.
  const MP3_ONLY_KINDS = { 'sample pack': true, 'bundle': true };

  function mp3Only(s) {
    const rel = s && catalog ? catalog[s] : null;
    return !!(rel && MP3_ONLY_KINDS[rel.k] === true);
  }

  // three sources now, not two: '/s/' flac, '/p/' 128k mp3, and 'vault' — the
  // same 128k mp3 already sitting in IndexedDB, played off a blob: URL. Reads
  // only synchronous state (see "the synchronous boundary" below), because
  // load() assigns the src inside an `ended` handler on iOS.
  function streamPath(s, nn) {
    const v = vaulted(s, nn);
    if (mp3Only(s)) return v ? 'vault' : '/p/';
    if (mode === 'saver') return v ? 'vault' : '/p/';
    // lossless is the user's call and never *auto*-demotes: it asks for flac
    // even with the link down. An outright load error still falls through, and
    // the error path prefers the vault over the network — see fallbackPath().
    if (mode === 'lossless') return canFlac ? '/s/' : (v ? 'vault' : '/p/');
    if (isOffline() || slowLink() || (demoteCount > 0 && !promotable)) {
      return v ? 'vault' : '/p/';
    }
    return canFlac ? '/s/' : (v ? 'vault' : '/p/');
  }

  // the src a path resolves to. A vault path is only ever returned by
  // streamPath() when urls already holds the key, so the get cannot miss.
  function srcFor(path, s, nn) {
    return path === 'vault'
      ? urls.get(vaultKey(s, nn))
      : API + path + s + '/' + nn;
  }

  // where a failing lossless source, a stall, a drained runway or a load error
  // sends the current track: the saved copy when there is one, the 128k stream
  // otherwise.
  function fallbackPath() {
    return slug && urls.has(vaultKey(slug, trackNN)) ? 'vault' : '/p/';
  }

  const dataEl = document.getElementById('store-data');
  const bar = document.getElementById('store-player');
  let audio = document.getElementById('store-audio');
  // the status line is docked page-level on / and sits under the buy button on
  // a release page. One setter, whichever element the page happens to carry.
  const status = document.getElementById('store-status') ||
    document.getElementById('release-status');
  const docked = !!status && status.id === 'store-status';
  // no .store-grid check: a release page has cards nowhere and a tracklist
  // instead. Clicks are delegated off document, so neither grid is required.
  if (!dataEl || !bar || !audio) return;

  // two elements, one active: a source handoff loads on the idle one while the
  // active one keeps playing. Attributes are copied over except id, which has
  // to stay unique. createElement only — the CSP requires Trusted Types.
  let standby = document.createElement('audio');
  Array.prototype.forEach.call(audio.attributes, a => {
    if (a.name !== 'id') standby.setAttribute(a.name, a.value);
  });
  audio.after(standby);

  function swapPointers() {
    const idle = audio;
    audio = standby;
    standby = idle;
  }

  // release an element's connection. Clearing a src-less element would fire a
  // spurious error event, so the attribute is checked first.
  function clearEl(el) {
    el.pause();
    if (el.hasAttribute('src')) {
      el.removeAttribute('src');
      el.load();
    }
  }

  // listeners sit on both elements and the wrapper drops events from the idle
  // one, so handler bodies can keep reading the `audio` pointer.
  function bindBoth(type, fn) {
    const guard = e => {
      if (e.target !== audio) return;
      fn(e);
    };
    audio.addEventListener(type, guard);
    standby.addEventListener(type, guard);
  }

  // iOS/Safari only grants playback from a user gesture — the standby element
  // gets its own silent unlock the first time the user presses play.
  let unlocked = false;

  function unlockStandby() {
    if (unlocked) return;
    unlocked = true;
    try {
      standby.muted = true;
      // load() inside the gesture is what actually lifts webkit's playback
      // restriction on a src-less element; the muted play is belt-and-braces
      standby.load();
      const up = standby.play();
      if (up && up.then) {
        up.then(() => { standby.pause(); standby.muted = false; })
          .catch(() => { standby.muted = false; });
      }
    } catch (e) { /* unlock is best-effort */ }
  }

  let catalog;
  try {
    catalog = JSON.parse(dataEl.textContent);
  } catch (e) {
    return;
  }

  // ── the vault ──────────────────────────────────────────────────────────────
  //
  // Chrome and WebKit deliberately cap how far ahead <audio> will buffer and
  // never download a whole file, so driving into a dead zone drains the buffer
  // and the music stops. The vault fetches whole 128k mp3 files into IndexedDB
  // ahead of the playhead; the dual-element handoff below then swaps onto a
  // blob: URL when the live stream falters or the network is gone. No Service
  // Worker, no MSE — an IDB blob and URL.createObjectURL behave the same in
  // every engine, iOS shells included.
  //
  // Every call is wrapped. A browser with IndexedDB blocked or missing (private
  // mode quirks) simply has no vault, and the player behaves exactly as it did
  // before this layer existed.
  const VAULT_CAP = 200 * 1024 * 1024;   // bytes held before LRU eviction
  const WINDOW_AHEAD = 2;                // tracks prefetched past the current one
  const NO_SIGNAL = 'no signal, and this one isn’t saved yet.';

  const idbOK = (function () {
    try { return typeof indexedDB !== 'undefined' && !!indexedDB; } catch (e) { return false; }
  })();

  let dbPromise = null;

  // one connection, opened lazily on first need and never rejected: a failure
  // resolves null and every caller treats that as "no vault".
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(resolve => {
      if (!idbOK) { resolve(null); return; }
      // ask once for durable storage. The answer is advisory — Safari evicts a
      // plain tab's data after seven idle days either way — so it is ignored.
      try {
        if (navigator.storage && navigator.storage.persist) {
          const asked = navigator.storage.persist();
          if (asked && asked.catch) asked.catch(() => { /* advisory */ });
        }
      } catch (e) { /* best effort */ }

      let req;
      try {
        req = indexedDB.open('mj-audio', 1);
      } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks');
        } catch (e) { /* the open handlers below report the failure */ }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return dbPromise;
  }

  // key shape: 'slug/NN'. One string, so the store needs no index and eviction
  // is a single cursor walk.
  function vaultKey(s, nn) {
    return s + '/' + nn;
  }

  function vaulted(s, nn) {
    return !!s && urls.has(vaultKey(s, nn));
  }

  // a read that also touches `at` — the LRU clock is "last played or prefetched"
  function vaultGet(key) {
    return openDb().then(db => {
      if (!db) return null;
      return new Promise(resolve => {
        let t;
        try { t = db.transaction('tracks', 'readwrite'); } catch (e) { resolve(null); return; }
        t.onabort = () => resolve(null);
        t.onerror = e2 => { if (e2 && e2.preventDefault) e2.preventDefault(); resolve(null); };
        const store = t.objectStore('tracks');
        const req = store.get(key);
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const rec = req.result;
          if (!rec || !rec.blob) { resolve(null); return; }
          rec.at = Date.now();
          try { store.put(rec, key); } catch (e) { /* the read still stands */ }
          resolve(rec.blob);
        };
      });
    }).catch(() => null);
  }

  function vaultHas(key) {
    return openDb().then(db => {
      if (!db) return false;
      return new Promise(resolve => {
        let t;
        try { t = db.transaction('tracks', 'readonly'); } catch (e) { resolve(false); return; }
        t.onabort = () => resolve(false);
        t.onerror = e2 => { if (e2 && e2.preventDefault) e2.preventDefault(); resolve(false); };
        const req = t.objectStore('tracks').count(key);
        req.onerror = () => resolve(false);
        req.onsuccess = () => resolve(req.result > 0);
      });
    }).catch(() => false);
  }

  // every key with its size and clock, blobs left alone. At the cap this is
  // ~50 rows, so a cursor walk on eviction is cheaper than a second meta store
  // that could drift out of step with the real one.
  function vaultRows(db) {
    return new Promise(resolve => {
      const rows = [];
      let t;
      try { t = db.transaction('tracks', 'readonly'); } catch (e) { resolve(rows); return; }
      t.onabort = () => resolve(rows);
      t.onerror = e2 => { if (e2 && e2.preventDefault) e2.preventDefault(); resolve(rows); };
      t.oncomplete = () => resolve(rows);
      const req = t.objectStore('tracks').openCursor();
      req.onerror = () => resolve(rows);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        const v = cur.value || {};
        rows.push({ key: cur.key, bytes: v.bytes || 0, at: v.at || 0 });
        cur.continue();
      };
    });
  }

  function vaultDelete(db, keys) {
    if (!keys.length) return Promise.resolve();
    return new Promise(resolve => {
      let t;
      try { t = db.transaction('tracks', 'readwrite'); } catch (e) { resolve(); return; }
      t.onabort = () => resolve();
      t.onerror = e2 => { if (e2 && e2.preventDefault) e2.preventDefault(); resolve(); };
      t.oncomplete = () => resolve();
      const store = t.objectStore('tracks');
      keys.forEach(k => { try { store.delete(k); } catch (e) { /* skip it */ } });
    });
  }

  // oldest `at` first until the total is back under the cap
  function vaultEvict(db) {
    return vaultRows(db).then(rows => {
      let total = 0;
      for (let i = 0; i < rows.length; i++) total += rows[i].bytes;
      if (total <= VAULT_CAP) return null;
      rows.sort((a, b) => a.at - b.at);
      const doomed = [];
      for (let i = 0; i < rows.length && total > VAULT_CAP; i++) {
        doomed.push(rows[i].key);
        total -= rows[i].bytes;
      }
      return vaultDelete(db, doomed);
    });
  }

  function vaultEvictOldest(db) {
    return vaultRows(db).then(rows => {
      if (!rows.length) return null;
      rows.sort((a, b) => a.at - b.at);
      return vaultDelete(db, [rows[0].key]);
    });
  }

  // resolves 'ok' | 'quota' | 'fail' — the caller only retries a quota refusal
  function vaultPutOnce(db, key, blob) {
    return new Promise(resolve => {
      let t;
      try { t = db.transaction('tracks', 'readwrite'); } catch (e) { resolve('fail'); return; }
      let why = 'fail';
      t.onabort = () => resolve(why);
      t.onerror = e2 => {
        if (e2 && e2.preventDefault) e2.preventDefault();
        resolve(why);
      };
      t.oncomplete = () => resolve('ok');
      try {
        const req = t.objectStore('tracks').put(
          { blob: blob, bytes: blob.size, at: Date.now() }, key
        );
        req.onerror = () => {
          if (req.error && req.error.name === 'QuotaExceededError') why = 'quota';
        };
      } catch (e) {
        why = e && e.name === 'QuotaExceededError' ? 'quota' : 'fail';
        try { t.abort(); } catch (e2) { /* already dead */ }
      }
    });
  }

  function vaultPut(key, blob) {
    return openDb().then(db => {
      if (!db) return false;
      return vaultPutOnce(db, key, blob).then(res => {
        if (res === 'ok') return vaultEvict(db).then(() => true);
        if (res !== 'quota') return false;
        // a full origin: drop the coldest entry and try exactly once more,
        // then give up without a word — a missing save is not a failure the
        // listener can do anything about
        return vaultEvictOldest(db)
          .then(() => vaultPutOnce(db, key, blob))
          .then(again => again === 'ok');
      });
    }).catch(() => false);
  }

  // ── the prefetch window ────────────────────────────────────────────────────
  //
  // urls only ever holds the current track and the next two of the loaded
  // release. It exists so streamPath() and load() can answer synchronously:
  // WebKit keeps the page alive while audio plays but only honours a play()
  // issued inside the `ended` handler, so the src assignment at a track
  // boundary must not await an IDB read. Do not "simplify" this into a lookup
  // at load time.
  const urls = new Map();     // 'slug/NN' → blob: URL
  let fetchQueue = [];
  let fetching = false;
  let activeKey = '';       // the key runQueue is currently fetching
  let vaultAbort = null;
  let retryTimer = 0;

  // Two kinds of offline, and conflating them breaks the drive this layer was
  // built for. `linkDown` is the browser telling us the interface went away:
  // authoritative, and it clears only when the interface comes back. A failed
  // fetch is a guess — cellular signal drops and returns with no interface
  // change at all, so `offline`/`online` never fire on a phone, and a hard flag
  // set from a fetch would kill the queue for the rest of the session and pin
  // auto to 128k with no way back. So a fetch failure is *soft*: it holds for a
  // doubling backoff, then lets the next attempt through. A bad guess costs one
  // load on the wrong source, which the demote machinery already handles.
  let linkDown = false;
  try { linkDown = navigator.onLine === false; } catch (e) { /* assume online */ }
  let fetchFailedAt = 0;
  let fetchBackoff = 0;
  const BACKOFF_MIN = 15000;    // ms before the first retry after a failure
  const BACKOFF_MAX = 120000;   // ms ceiling on the doubling

  function isOffline() {
    return linkDown || (fetchFailedAt !== 0 && Date.now() - fetchFailedAt < fetchBackoff);
  }

  function windowKeys() {
    const out = [];
    const rel = slug ? catalog[slug] : null;
    if (!rel || !rel.tr) return out;
    for (let i = index; i <= index + WINDOW_AHEAD && i < rel.tr.length; i++) {
      out.push(vaultKey(slug, pad(rel.tr[i][0])));
    }
    return out;
  }

  function trimUrls(keep) {
    urls.forEach((url, key) => {
      if (keep.indexOf(key) !== -1) return;
      try { URL.revokeObjectURL(url); } catch (e) { /* already gone */ }
      urls.delete(key);
    });
  }

  function revokeAll() {
    urls.forEach(url => {
      try { URL.revokeObjectURL(url); } catch (e) { /* already gone */ }
    });
    urls.clear();
  }

  function retryClear() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = 0;
  }

  // the backoff's own alarm clock. Nothing else re-opens the queue after a
  // fetch failure — a phone that never fires an `online` event would otherwise
  // wait forever.
  function retryLater() {
    retryClear();
    retryTimer = setTimeout(() => {
      retryTimer = 0;
      runQueue();
      paintQuality();   // the window closed: auto may reach for flac again
    }, fetchBackoff);
  }

  // the body in flight only. The key it was fetching goes back to the head of
  // the queue, so whatever reopens the queue picks up where this left off.
  function abortInFlight() {
    if (vaultAbort) {
      try { vaultAbort.abort(); } catch (e) { /* nothing in flight */ }
      vaultAbort = null;
    }
    if (activeKey && fetchQueue.indexOf(activeKey) === -1) fetchQueue.unshift(activeKey);
    activeKey = '';
  }

  // the whole queue. Only for stop() and a release change, where the contents
  // are downloads for music nobody is waiting on — never for a link failure,
  // which has to leave the queue standing so a resume has something to resume.
  function abortQueue() {
    abortInFlight();
    fetchQueue = [];
    retryClear();
  }

  function noteFetchFailure(key) {
    fetchFailedAt = Date.now();
    fetchBackoff = Math.min(fetchBackoff ? fetchBackoff * 2 : BACKOFF_MIN, BACKOFF_MAX);
    if (key && fetchQueue.indexOf(key) === -1) fetchQueue.unshift(key);
    retryLater();
    paintQuality();
  }

  function noteFetchSuccess() {
    fetchFailedAt = 0;
    fetchBackoff = 0;
    retryClear();
  }

  // called after every load(): slide the window, revoke what fell out of it,
  // adopt what the vault already holds and queue the rest.
  function ensureWindow() {
    const keys = windowKeys();
    trimUrls(keys);
    fetchQueue = fetchQueue.filter(k => keys.indexOf(k) !== -1);
    keys.forEach(key => {
      if (urls.has(key) || fetchQueue.indexOf(key) !== -1) return;
      vaultGet(key).then(blob => {
        // the window may have moved while the read was out
        if (urls.has(key) || windowKeys().indexOf(key) === -1) return;
        if (blob) {
          adopt(key, blob);
          return;
        }
        if (fetchQueue.indexOf(key) === -1) fetchQueue.push(key);
        runQueue();
      });
    });
    runQueue();
  }

  function adopt(key, blob) {
    if (urls.has(key) || windowKeys().indexOf(key) === -1) return;
    try {
      urls.set(key, URL.createObjectURL(blob));
    } catch (e) { return; }
    // the chip predicts the next load's source, and this key may have changed it
    paintQuality();
  }

  // one fetch at a time: a parallel burst competes with the live stream for the
  // same link, which is the thing the vault exists to protect.
  function runQueue() {
    if (fetching || isOffline() || !fetchQueue.length) return;
    const key = fetchQueue.shift();
    if (urls.has(key) || windowKeys().indexOf(key) === -1) { runQueue(); return; }
    fetching = true;
    activeKey = key;
    if (!vaultAbort) {
      try { vaultAbort = new AbortController(); } catch (e) { vaultAbort = null; }
    }
    const ctl = vaultAbort;
    // it may have been stored since it was queued — a count beats a download
    vaultHas(key)
      .then(has => (has ? vaultGet(key) : fetchTrack(key, ctl)))
      .then(blob => { if (blob) adopt(key, blob); })
      .catch(() => { /* a miss is a miss */ })
      .then(() => {
        fetching = false;
        if (activeKey === key) activeKey = '';
        runQueue();
      });
  }

  function fetchTrack(key, ctl) {
    const cut = key.lastIndexOf('/');
    const s = key.slice(0, cut);
    const nn = key.slice(cut + 1);
    const opts = { mode: 'cors', cache: 'no-store' };
    if (ctl) opts.signal = ctl.signal;
    return fetch(API + '/p/' + s + '/' + nn, opts)
      .then(r => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then(blob => {
        // a body arrived, so the link is up whatever a previous failure said
        noteFetchSuccess();
        return vaultPut(key, blob).then(() => blob);
      })
      .catch(err => {
        // an abort is the queue being torn down on purpose. A TypeError is the
        // network — or, from localhost, a CORS refusal, which looks identical
        // and is treated the same: back off, retry later, leave playback alone.
        if (err && err.name === 'AbortError') return null;
        if (err instanceof TypeError) noteFetchFailure(key);
        return null;
      });
  }

  window.addEventListener('offline', () => {
    linkDown = true;
    // the in-flight body is dead, but the queue is not: `online` resumes it,
    // and there is nothing for the backoff clock to try until then
    abortInFlight();
    retryClear();
    paintQuality();
  });

  window.addEventListener('online', () => {
    linkDown = false;
    fetchFailedAt = 0;
    fetchBackoff = 0;
    retryClear();
    if (status && status.textContent === NO_SIGNAL) setStatus('');
    ensureWindow();
    paintQuality();
  });

  const artEl = document.getElementById('store-player-art');
  const releaseEl = document.getElementById('store-player-release');
  const trackEl = document.getElementById('store-player-track');
  const prevBtn = document.getElementById('store-prev');
  const toggleBtn = document.getElementById('store-toggle');
  const nextBtn = document.getElementById('store-next');
  const stopBtn = document.getElementById('store-stop');
  const scrub = document.getElementById('store-scrub');
  const timeEl = document.getElementById('store-time');
  const qualityBtn = document.getElementById('store-quality');
  const qModeEl = document.getElementById('store-quality-mode');
  const qNowEl = document.getElementById('store-quality-now');

  let slug = null;   // release currently loaded in the bar
  let index = 0;     // 0-based position in that release's track list
  let scrubbing = false;
  let trackNN = '';    // zero-padded track number of the loaded source
  let currentPath = '/p/';  // path the loaded source was built from
  let retried = false; // one mp3 retry per load, so errors can't loop

  function clock(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  // the bar is fixed to the viewport now, so while it is up it floats over
  // whatever is at the foot of the page. body.store-open opens a matching
  // runway underneath the footer; the two are toggled together and nowhere
  // else, so the padding can never outlive the bar.
  function showBar(on) {
    bar.hidden = !on;
    document.body.classList.toggle('store-open', on);
    sizeDock();
  }

  // the status note is a docked strip too, so it goes through one setter:
  // content and dock geometry can never disagree. textContent, never
  // innerHTML — Trusted Types is enforced.
  function setStatus(msg) {
    if (!status) return;
    status.textContent = msg;
    sizeDock();
  }

  // the runway is measured, not guessed: the bar restacks from one row to four
  // under 768px (105px tall against 283px) and grows again when a track title
  // wraps, and the note's height depends on how far its sentence wraps. A
  // hard-coded padding would be wrong in most states.
  // Two properties come out of one pass, so the two strips can never disagree:
  //   --store-note-lift  how far the note sits above the dock line, which is
  //                      the bar's height plus a 10px gap when the bar is up
  //                      and 0 when it is down, so the note takes the bar's
  //                      slot instead of floating over empty space.
  //   --store-dock-h     the whole docked stack, for the footer runway.
  // setProperty writes custom properties through the CSSOM — that is not a
  // style attribute, and style-src does not gate it.
  function sizeDock() {
    // only the home page's note is docked to the viewport; a release page's
    // #release-status sits in the flow under the buy button, so it owes the
    // footer no runway and must not move the bar's lift.
    const noteOn = docked && status.textContent !== '';
    document.body.classList.toggle('store-note', noteOn);

    const barH = bar.hidden ? 0 : bar.offsetHeight;
    const gap = barH ? 10 : 0;
    // the lift moves the note, so it has to land before the note is measured
    document.body.style.setProperty('--store-note-lift', (barH + gap) + 'px');

    // the gap only exists when there are two strips to separate — counting it
    // against a lone bar would claim runway the dock is not using
    const noteH = noteOn ? status.offsetHeight : 0;
    const total = barH + (noteH ? gap + noteH : 0);
    if (total > 0) {
      document.body.style.setProperty('--store-dock-h', total + 'px');
    } else {
      document.body.style.removeProperty('--store-dock-h');
      document.body.style.removeProperty('--store-note-lift');
    }
  }

  // re-measure on resize, but only while something is docked, and only once
  // per frame — this is the player's own path, not the starfield's render path
  let dockFrame = 0;
  window.addEventListener('resize', () => {
    if (dockFrame) return;
    if (bar.hidden && !document.body.classList.contains('store-note')) return;
    dockFrame = requestAnimationFrame(() => {
      dockFrame = 0;
      sizeDock();
    });
  });

  function card(s) {
    return document.querySelector('.store-card[data-slug="' + s + '"]');
  }

  // the zero-padded track number the API takes literally, and the index it
  // came from. Both directions read the catalog, never the DOM: a row's
  // printed name is display text, the catalog is the contract.
  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function indexOfTrack(s, nn) {
    const rel = catalog[s];
    if (!rel || !rel.tr) return -1;
    for (let i = 0; i < rel.tr.length; i++) {
      if (pad(rel.tr[i][0]) === nn) return i;
    }
    return -1;
  }

  function trackName(s, i) {
    const rel = catalog[s];
    return rel && rel.tr && rel.tr[i] ? rel.tr[i][1] : '';
  }

  // one painter for both surfaces: the catalog cards on / and the tracklist
  // rows on /music/<slug>/. Nothing else writes their state, so the two can
  // never disagree with the bar.
  function markCards() {
    const sounding = !!slug && !audio.paused;

    document.querySelectorAll('.store-card').forEach(c => {
      const active = c.dataset.slug === slug;
      c.classList.toggle('is-active', active);
      c.classList.toggle('is-playing', active && sounding);
      const btn = c.querySelector('.store-play');
      if (!btn) return;
      const playing = active && sounding;
      const name = catalog[c.dataset.slug] ? catalog[c.dataset.slug].t : '';
      btn.setAttribute('aria-label', (playing ? 'pause ' : 'play ') + name);
    });

    document.querySelectorAll('.track-play').forEach(btn => {
      const s = btn.dataset.slug;
      const i = indexOfTrack(s, btn.dataset.track);
      const active = s === slug && i === index && i !== -1;
      const on = active && sounding;
      const row = btn.closest ? btn.closest('li') : null;
      if (row) {
        row.classList.toggle('is-active', active);
        row.classList.toggle('is-playing', on);
      }
      btn.classList.toggle('is-playing', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', (on ? 'pause ' : 'play ') + trackName(s, i));
    });
  }

  function syncToggle() {
    const sounding = !audio.paused;
    toggleBtn.classList.toggle('is-playing', sounding);
    toggleBtn.setAttribute('aria-label', sounding ? 'pause playback' : 'resume playback');
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = slug && sounding ? 'playing' : 'paused';
    }
    markCards();
  }

  // the label reads the setting, not the loaded source: a mode change lands on
  // the next track, so it names the quality the next load will use
  function paintQuality() {
    if (!qualityBtn) return;
    // the chip says "now", so with a track loaded it names the source that is
    // actually loaded — a mode change lands on the next track and the mode word
    // beside it already says so. Idle, there is nothing loaded to describe, so
    // it predicts what the next load would pick. Before the vault the two could
    // only disagree for one track; now the prefetch window moves under the
    // prediction (step forward and back and a key leaves urls, then returns),
    // and a chip reading "saved" over a 128k stream is simply wrong.
    const path = slug ? currentPath : streamPath(slug, trackNN);
    const chip = path === 'vault' ? 'saved' : (path === '/s/' ? 'flac' : '128k');
    const words = path === 'vault'
      ? 'saved offline'
      : (path === '/s/' ? 'lossless' : '128 kbps');
    qModeEl.textContent = mode;
    qNowEl.textContent = ' · ' + chip;
    qualityBtn.setAttribute(
      'aria-label',
      'streaming quality: ' + mode + ', ' + words + ' now. ' + NEXT_ACTION[mode]
    );
  }

  // cumulative buffering on the current track. Only auto watches it, and only
  // while a lossless source is loaded — lossless mode is the user's call.
  let stallTimer = 0, stallStart = 0, stalledMs = 0;

  // a flac load that never produces audio is a stall the stall clock can't see:
  // no `waiting` fires before playback has begun.
  let startTimer = 0;

  function startClear() {
    if (startTimer) clearTimeout(startTimer);
    startTimer = 0;
  }

  // previous runway sample, so a buffer that is shrinking can be told apart
  // from one that is merely small
  let lastRunway = Infinity;

  function stallReset() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = 0;
    stallStart = 0;
    stalledMs = 0;
  }

  function stallBegin() {
    if (mode !== 'auto' || currentPath !== '/s/' || !slug || stallStart) return;
    stallStart = Date.now();
    stallTimer = setTimeout(() => {
      recordDemote();
      handoff(fallbackPath());
    }, Math.max(0, STALL_BUDGET - stalledMs));
  }

  // the offline dead end. Nothing arms the stall clock on a '/p/' source, and a
  // blob cannot stall for network reasons, so an offline listener whose track
  // was never saved would otherwise sit in silence with no explanation. Three
  // guards keep it off the healthy path: the link has to be down, the buffer
  // has to be dry, and the playhead has to have stopped moving — a prefetch
  // that failed while the live stream plays fine trips none of them.
  const OFFLINE_STALL = 4000;
  let offlineTimer = 0;

  function offlineStallClear() {
    if (offlineTimer) clearTimeout(offlineTimer);
    offlineTimer = 0;
  }

  function offlineStallBegin() {
    if (!isOffline() || !slug || currentPath === 'vault' || offlineTimer) return;
    if (audio.paused) return;
    const was = audio.currentTime;
    offlineTimer = setTimeout(() => {
      offlineTimer = 0;
      if (!isOffline() || !slug || currentPath === 'vault') return;
      if (audio.currentTime !== was) return;                  // still moving
      if (bufferedEnd(audio.currentTime) - audio.currentTime > 1) return;  // still has runway
      audio.pause();
      reportLoadFailure(NO_SIGNAL);
    }, OFFLINE_STALL);
  }

  function stallEnd() {
    if (stallStart) stalledMs += Date.now() - stallStart;
    stallStart = 0;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = 0;
  }

  // the end of the line for a source: nothing is playing and nothing is left
  // to try
  function reportLoadFailure(msg) {
    stallReset();
    offlineStallClear();
    setStatus(msg || 'that preview didn’t load. try again in a moment.');
    syncToggle();
  }

  // hand the current track to the idle element on another source path: it loads
  // and seeks while the active one keeps playing off its buffer, so the switch
  // costs no audible gap. Anything that changes what should be playing — load(),
  // stop(), a mode change — bumps the generation and orphans a handoff in
  // flight. forcePlay covers the error path, where the active element is already
  // paused but the listener still expects playback to continue.
  let handoffGen = 0;

  function handoff(toPath, forcePlay, fromError) {
    if (!slug) return;
    // the window can move between the decision and the call — a vault target
    // with no URL behind it is the 128k stream instead
    if (toPath === 'vault' && !urls.has(vaultKey(slug, trackNN))) toPath = '/p/';
    if (currentPath === toPath) return;
    const gen = ++handoffGen;
    lastRunway = Infinity;   // the new source buffers on its own terms

    function done() {
      standby.removeEventListener('error', failed);
      if (gen !== handoffGen) return;
      const at = audio.currentTime;   // read before the active element is released
      const wasPlaying = forcePlay || !audio.paused;
      // seek first: the active element is still playing until the line below
      try { standby.currentTime = at; } catch (e) { /* not seekable yet */ }
      clearEl(audio);
      swapPointers();
      currentPath = toPath;
      stallReset();
      offlineStallClear();
      paintQuality();
      if (wasPlaying) {
        const p = audio.play();
        if (p && p.catch) p.catch(() => syncToggle());
      } else {
        syncToggle();
      }
    }

    function failed() {
      standby.removeEventListener('canplay', done);
      if (gen !== handoffGen) return;
      handoffGen++;   // nothing left to honour from this attempt
      clearEl(standby);
      // a demote can just give up and leave the current source playing, but an
      // error-path handoff has no live source behind it — the listener's
      // message is all that is left
      if (fromError) reportLoadFailure(isOffline() && toPath !== 'vault' ? NO_SIGNAL : '');
    }

    standby.addEventListener('canplay', done, { once: true });
    standby.addEventListener('error', failed, { once: true });
    // the element was cloned from a preload="none" tag, so a bare src assignment
    // would download nothing
    standby.preload = 'auto';
    standby.src = srcFor(toPath, slug, trackNN);
  }

  // ⏮ is a restart before it is a skip — the same convention every transport
  // uses, and the reason it stays live on track one once the track is running.
  // The end stops use `disabled`, not aria-disabled: they are player state and
  // a control with nothing to do should leave the tab order.
  function paintEnds() {
    if (!slug) {
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }
    const total = catalog[slug].tr.length;
    prevBtn.disabled = !(index > 0 || audio.currentTime > RESTART_AFTER);
    nextBtn.disabled = index >= total - 1;
  }

  // lock screen, hardware keys and the OS media widget. No CSP surface: this
  // is an API call, not a resource load. The artwork is whatever the bar's
  // thumb is actually showing — the 210px cover on both pages.
  function setMetadata() {
    if (!slug || !('mediaSession' in navigator) || !window.MediaMetadata) return;
    const art = artEl ? artEl.currentSrc || artEl.src : '';
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: trackName(slug, index),
        artist: 'matthew jamison',
        album: catalog[slug] ? catalog[slug].t : '',
        artwork: art ? [{ src: art, sizes: '210x210', type: 'image/webp' }] : []
      });
    } catch (e) { /* an engine that rejects the descriptor — skip it */ }
  }

  function load(nextSlug, nextIndex, autoplay) {
    const rel = catalog[nextSlug];
    // a release with no preview clips has nothing to load — the markup omits
    // its play control, and this is the matching runtime guard
    if (!rel || !rel.tr || !rel.tr.length) return;
    const total = rel.tr.length;
    if (nextIndex < 0 || nextIndex >= total) return;

    // a different record: the queue is fetching for one nobody is listening to
    if (nextSlug !== slug) abortQueue();

    slug = nextSlug;
    index = nextIndex;
    const track = rel.tr[index];      // [trackNumber, title, seconds]
    const nn = track[0] < 10 ? '0' + track[0] : String(track[0]);

    trackNN = nn;
    retried = false;
    stallReset();
    offlineStallClear();
    startClear();        // a rapid skip re-arms the deadline below
    lastRunway = Infinity;
    lastBufEnd = -1;     // buffer readings don't carry across tracks
    handoffGen++;        // a handoff in flight is for the track being replaced
    clearEl(standby);    // and so is whatever it half-loaded
    // synchronous, all of it: on iOS this runs inside the `ended` handler and
    // the play() below only counts while that handler is still on the stack.
    // streamPath reads the in-memory url map, never IndexedDB.
    currentPath = streamPath(slug, nn);
    // a promotion is spent the moment it lands: any later one needs fresh
    // evidence, and demoteCount survives so a re-stall backs off harder
    if (currentPath === '/s/' && promotable) {
      promotable = false;
      healthySince = 0;
    }
    audio.src = srcFor(currentPath, slug, nn);
    // nothing to arm on a blob (there is no download to stall), and nothing to
    // arm offline either — the deadline's whole point is to reach a better
    // source, and offline there isn't one.
    if (autoplay && mode === 'auto' && currentPath === '/s/' && !isOffline()) {
      startTimer = setTimeout(() => {
        startTimer = 0;
        recordDemote();
        handoff(fallbackPath(), true);
      }, START_DEADLINE);
    }
    paintQuality();
    showBar(true);

    // on / the thumb comes off the card that started it; a release page ships
    // its own cover in the bar's src already, so there is nothing to copy and
    // the attribute is left exactly as the generator wrote it.
    const c = card(slug);
    const img = c ? c.querySelector('img') : null;
    if (img) artEl.src = img.currentSrc || img.src;
    releaseEl.textContent = rel.t;
    trackEl.textContent = total > 1
      ? nn + ' / ' + total + ' · ' + track[1]
      : track[1];

    const dur = track[2] || 0;
    scrub.max = String(Math.max(1, Math.round(dur)));
    scrub.value = '0';
    timeEl.textContent = '0:00 / ' + clock(dur);
    scrub.setAttribute('aria-valuetext', '0:00 of ' + clock(dur));

    paintEnds();
    setMetadata();

    if (autoplay) {
      const p = audio.play();
      if (p && p.catch) p.catch(() => syncToggle());
    }
    syncToggle();
    // slide the prefetch window: this track, then the next two. Whatever the
    // vault already holds becomes a blob: URL now, so the next `ended` can
    // reach it without touching IndexedDB.
    ensureWindow();
    // measured last: the title above is what decides how tall the bar wraps
    sizeDock();
  }

  function step(delta) {
    if (!slug) return;
    const total = catalog[slug].tr.length;
    const target = index + delta;
    if (target < 0 || target >= total) return;
    load(slug, target, true);
  }

  function stop() {
    stallReset();
    startClear();
    offlineStallClear();
    lastRunway = Infinity;
    handoffGen++;
    clearEl(audio);
    clearEl(standby);
    // the elements are released above, so every blob: URL is now unreferenced
    abortQueue();
    revokeAll();
    slug = null;
    currentPath = '/p/';   // nothing is loaded; the chip goes back to predicting
    showBar(false);
    paintEnds();
    paintQuality();
    markCards();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    }
  }

  function playPause() {
    if (audio.paused) {
      const p = audio.play();
      if (p && p.catch) p.catch(() => syncToggle());
    } else {
      audio.pause();
    }
    syncToggle();
  }

  function prev() {
    if (!slug) return;
    if (audio.currentTime > RESTART_AFTER || index === 0) {
      try { audio.currentTime = 0; } catch (e) { /* not seekable yet */ }
      const p = audio.play();
      if (p && p.catch) p.catch(() => syncToggle());
      paintEnds();   // back at 0 on track one, ⏮ has nothing left to do
      syncToggle();
      return;
    }
    step(-1);
  }

  // one listener for the whole document rather than one per grid: the play
  // controls live in .store-grid, .samples-grid and a release page's
  // .release-tracks, and the buy button in a card foot or a release head.
  // A tracklist button carries BOTH classes (.store-play .track-play), so the
  // explicit track case has to be tested first.
  document.addEventListener('click', e => {
    const t = e.target;
    if (!t || !t.closest) return;

    const row = t.closest('.track-play');
    if (row && row.dataset.slug) {
      const s = row.dataset.slug;
      const i = indexOfTrack(s, row.dataset.track);
      if (i === -1) return;
      unlockStandby();
      if (s === slug && i === index) playPause();
      else load(s, i, true);
      return;
    }

    const play = t.closest('.store-play');
    if (play && play.dataset.slug) {
      const s = play.dataset.slug;
      unlockStandby();
      if (s === slug) playPause();
      else load(s, 0, true);
      return;
    }

    const buy = t.closest('.store-buy') || t.closest('.release-buy');
    if (buy && buy.dataset.slug) checkout(buy);
  });

  // a card whose catalog entry carries no preview clips gets no play control:
  // the button would load nothing and read as broken. Removed rather than
  // disabled — there is no preview to offer, so there is nothing to announce.
  document.querySelectorAll('.store-card .store-play').forEach(btn => {
    const rel = catalog[btn.dataset.slug];
    if (!rel || !rel.tr || !rel.tr.length) btn.remove();
  });

  function checkout(btn) {
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true');
    setStatus('');
    fetch(API + '/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: btn.dataset.slug })
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(body => {
        if (!body || !body.url) throw new Error('no url');
        window.location.href = body.url;
      })
      .catch(() => {
        btn.removeAttribute('aria-busy');
        setStatus(
          'checkout didn’t open. try again, or email matthewjamisonmusicinquiries@gmail.com'
        );
      });
  }

  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', () => step(1));
  stopBtn.addEventListener('click', stop);
  toggleBtn.addEventListener('click', () => {
    if (!slug) return;
    unlockStandby();
    playPause();
  });

  // lock screen and hardware media keys. Each handler is registered on its own
  // so an engine that doesn't know one action still gets the rest.
  if ('mediaSession' in navigator) {
    const handlers = [
      ['play', () => { if (slug && audio.paused) playPause(); }],
      ['pause', () => { if (slug && !audio.paused) playPause(); }],
      ['previoustrack', prev],
      ['nexttrack', () => step(1)]
    ];
    handlers.forEach(pair => {
      try {
        navigator.mediaSession.setActionHandler(pair[0], pair[1]);
      } catch (e) { /* an engine that doesn't know this action — skip it */ }
    });
  }

  if (qualityBtn) {
    // cycles auto → lossless → saver. The change lands on the next track load;
    // the playing track is left alone.
    qualityBtn.addEventListener('click', () => {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      try { localStorage.setItem(QUALITY_KEY, mode); } catch (e) { /* storage blocked */ }
      stallEnd();     // a pending demote belongs to the mode that armed it
      startClear();   // as does a startup deadline
      handoffGen++;   // and so does a handoff it already started
      paintQuality();
    });
    paintQuality();
  }

  bindBoth('play', syncToggle);
  // pausing during startup withdraws the deadline: a forced demote would resume
  // playback the listener just stopped
  bindBoth('pause', () => { stallEnd(); startClear(); offlineStallClear(); syncToggle(); });
  bindBoth('waiting', () => { stallBegin(); offlineStallBegin(); });
  bindBoth('stalled', () => { stallBegin(); offlineStallBegin(); });
  bindBoth('playing', () => { stallEnd(); startClear(); offlineStallClear(); });
  bindBoth('ended', () => {
    if (!slug) return;
    if (index < catalog[slug].tr.length - 1) step(1);
    else syncToggle();
  });

  bindBoth('timeupdate', () => {
    if (scrubbing || !slug) return;
    const dur = audio.duration || catalog[slug].tr[index][2] || 0;
    scrub.value = String(Math.round(audio.currentTime));
    timeEl.textContent = clock(audio.currentTime) + ' / ' + clock(dur);
    scrub.setAttribute('aria-valuetext', clock(audio.currentTime) + ' of ' + clock(dur));
    // the restart/skip split flips at 3s, so ⏮ has to be re-evaluated as the
    // track runs — this is the only end stop that time changes
    paintEnds();
  });

  // demote before the buffer runs dry rather than after: an audible stall is the
  // thing being avoided, so the swap has to start while there is still audio to
  // play through it. timeupdate fires ~4/s, cheap enough to sample raw.
  function runwayCheck() {
    if (mode !== 'auto' || currentPath !== '/s/' || !slug || audio.paused) return;
    const t = audio.currentTime;
    const b = audio.buffered;
    let end = -1;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= t && t < b.end(i)) { end = b.end(i); break; }
    }
    if (end < 0) return;   // already dry — the stall clock owns that case
    const runway = end - t;
    const dur = audio.duration;
    // a fully buffered track has nothing left to download, and the last seconds
    // of any track shrink the runway to zero by design
    if (dur && (end >= dur - 0.5 || dur - t <= RUNWAY_ENDGAME)) {
      lastRunway = runway;
      return;
    }
    if (runway < RUNWAY_MIN && runway < lastRunway) {
      recordDemote();
      handoff(fallbackPath());
      // currentPath only flips when the handoff lands, so the monitor has to
      // disarm itself in the meantime — every tick until then would otherwise
      // cancel and restart the swap
      lastRunway = -Infinity;
      return;
    }
    lastRunway = runway;
  }

  bindBoth('timeupdate', runwayCheck);

  // the way back up. While a demoted session plays mp3, sample the link every
  // few seconds; a long unbroken healthy streak plus an elapsed cooldown buys
  // one measured probe of the flac source, and only that sets promotable.
  let lastSample = 0;
  let lastBufEnd = -1;

  function bufferedEnd(t) {
    const b = audio.buffered;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= t && t < b.end(i)) return b.end(i);
    }
    return -1;
  }

  function healthCheck() {
    if (mode !== 'auto' || demoteCount === 0 || promotable) return;
    // the probe at the end of this is a network fetch — offline it can only fail
    if (isOffline()) return;
    // a vault source counts: the listener is hearing the demoted quality, and
    // the streak is what buys the probe that measures the link for real
    if ((currentPath !== '/p/' && currentPath !== 'vault') || !slug || audio.paused) return;
    // a pack has no flac source to be promoted to, and probing one would fire a
    // guaranteed 404 — the session's demote state is left untouched
    if (mp3Only(slug)) return;
    const now = Date.now();
    if (now - lastSample < SAMPLE_EVERY) return;
    const elapsedSec = lastSample ? (now - lastSample) / 1000 : 0;
    lastSample = now;

    const t = audio.currentTime;
    const end = bufferedEnd(t);
    const dur = audio.duration;
    // a blob is whole the instant it plays — there is nothing left to download
    const whole = currentPath === 'vault' ||
      (end >= 0 && dur && isFinite(dur) && end >= dur - 0.5);
    // growing at least as fast as the clock is the test — a buffer that only
    // holds its lead is keeping pace, one that slips is not
    const growing = end >= 0 && lastBufEnd >= 0 && elapsedSec > 0 &&
      end - lastBufEnd >= elapsedSec * 0.8;
    lastBufEnd = end;

    if (!slowLink() && (whole || growing)) {
      if (healthySince === 0) healthySince = now;
    } else {
      healthySince = 0;
      return;
    }

    const cooldown = Math.min(COOLDOWN_BASE * Math.pow(2, Math.max(0, demoteCount - 1)), COOLDOWN_MAX);
    if (now - healthySince >= HEALTH_STREAK && now - demotedAt >= cooldown) {
      probeLossless();
    }
  }

  // one ranged GET of the flac source, wall-clocked. The API answers GET only —
  // a HEAD comes back 404 — so the first half-megabyte is the measurement.
  function probeLossless() {
    if (probing || isOffline()) return;
    probing = true;
    const t0 = Date.now();
    fetch(API + '/s/' + slug + '/' + trackNN, {
      headers: { Range: 'bytes=0-' + PROBE_BYTES },
      cache: 'no-store'   // a disk-cache hit would read as a fast link
    }).then(r => {
      if (!r.ok) throw new Error('probe rejected');
      return r.arrayBuffer();
    }).then(buf => {
      // the body's own length, not the range we asked for: a short answer must
      // not read as a fast one
      const secs = Math.max(0.001, (Date.now() - t0) / 1000);
      if (buf.byteLength / secs >= PROBE_MIN_BPS) {
        promotable = true;
        paintQuality();
      } else {
        probeFailed();
      }
    }).catch(() => {
      probeFailed();
    }).then(() => {
      probing = false;
    });
  }

  function probeFailed() {
    demotedAt = Date.now();
    healthySince = 0;
  }

  bindBoth('timeupdate', healthCheck);

  bindBoth('loadedmetadata', () => {
    if (isFinite(audio.duration) && audio.duration > 0) {
      scrub.max = String(Math.round(audio.duration));
    }
  });

  bindBoth('error', () => {
    // stop() clears the src, which fires error too — only report a real failure
    if (!slug) return;
    // a lossless source that fails outright gets one mp3 attempt before the
    // failure reaches the listener
    if (currentPath === '/s/' && !retried) {
      retried = true;
      handoff(fallbackPath(), true, true);
      return;
    }
    // the link is down and this one was never saved. Say so plainly and stop:
    // there is nothing left to try, and auto-advancing would only fail again.
    if (isOffline() && currentPath !== 'vault') {
      reportLoadFailure(NO_SIGNAL);
      return;
    }
    reportLoadFailure();
  });

  scrub.addEventListener('pointerdown', () => { scrubbing = true; });
  scrub.addEventListener('pointerup', () => { scrubbing = false; });
  scrub.addEventListener('input', () => {
    const t = Number(scrub.value);
    const dur = audio.duration || (slug ? catalog[slug].tr[index][2] : 0) || 0;
    timeEl.textContent = clock(t) + ' / ' + clock(dur);
    scrub.setAttribute('aria-valuetext', clock(t) + ' of ' + clock(dur));
  });
  scrub.addEventListener('change', () => {
    scrubbing = false;
    if (slug) {
      try { audio.currentTime = Number(scrub.value); } catch (e) { /* not seekable yet */ }
    }
  });

  // the markup ships #store-toggle with .is-playing and "pause playback" so a
  // release bar reads correctly the instant a row is tapped. Nothing is loaded
  // yet at boot, so the label would otherwise lie until the first load(); the
  // bar is hidden either way, but the accessible name is not.
  paintEnds();
  syncToggle();
})();
