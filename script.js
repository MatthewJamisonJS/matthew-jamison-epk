const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// bio tab toggle
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.bio-content').forEach(c => c.classList.add('hidden'));
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    document.getElementById('bio-' + tab).classList.remove('hidden');
  });
});

// reduced motion: hero video holds a still frame instead of playing
(function () {
  if (!reducedMotion) return;
  const v = document.querySelector('.hero-bg-video');
  if (!v) return;
  v.removeAttribute('autoplay');
  v.removeAttribute('loop');
  const hold = () => {
    v.pause();
    try { v.currentTime = 0.1; } catch (e) { /* not seekable yet */ }
  };
  v.addEventListener('play', hold, { once: true });
  if (v.readyState >= 1) hold();
  else v.addEventListener('loadedmetadata', hold, { once: true });
})();

// pointer glow + section spotlight — user-initiated feedback, runs under
// reduced motion too (only ambient/autonomous motion is disabled there)
(function () {
  const glow = document.getElementById('page-glow');
  let raf = 0, x = 0, y = 0, section = null;
  function paint() {
    if (glow) {
      glow.style.left = x + 'px';
      glow.style.top = y + 'px';
    }
    if (section) {
      const r = section.getBoundingClientRect();
      section.style.setProperty('--mx', (x - r.left) + 'px');
      section.style.setProperty('--my', (y - r.top) + 'px');
    }
    raf = 0;
  }
  window.addEventListener('pointermove', e => {
    x = e.clientX;
    y = e.clientY;
    section = e.target.closest ? e.target.closest('.section') : null;
    if (!raf) raf = requestAnimationFrame(paint);
  }, { passive: true });
})();

// click pulse — one-shot ring at the pointer
window.addEventListener('pointerdown', e => {
  const p = document.createElement('span');
  p.className = 'click-pulse';
  p.style.left = e.clientX + 'px';
  p.style.top = e.clientY + 'px';
  document.body.appendChild(p);
  p.addEventListener('animationend', () => p.remove());
});

// catalog expand — first 12 shown, button reveals all 30
(function () {
  const btn = document.getElementById('catalog-more-btn');
  const grid = document.querySelector('.store-grid');
  if (!btn || !grid) return;
  btn.addEventListener('click', () => {
    const expanded = grid.classList.toggle('expanded');
    btn.setAttribute('aria-expanded', String(expanded));
    // textContent, not innerHTML — the CSP enforces Trusted Types. The
    // &nbsp; entities become literal non-breaking spaces here.
    btn.textContent = expanded
      ? '→ show fewer'
      : '→ full catalog \u00a0·\u00a0 29 releases';
  });
})();

// store: one shared <audio> for 29 releases, plus Stripe checkout hand-off.
// Everything below builds DOM with createElement/textContent — the CSP has no
// 'unsafe-inline' and requires Trusted Types, so innerHTML is not available.
(function () {
  const API = 'https://api.matthewjamison.dev';
  // play/pause are inline <svg> pairs baked into the markup; state is carried by
  // an .is-playing class and CSS picks which of the two icons is displayed.
  // Nothing here writes markup — the CSP requires Trusted Types.

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

  function streamPath() {
    if (mode === 'saver') return '/p/';
    if (mode === 'lossless') return canFlac ? '/s/' : '/p/';
    if ((demoteCount > 0 && !promotable) || slowLink()) return '/p/';
    return canFlac ? '/s/' : '/p/';
  }

  const dataEl = document.getElementById('store-data');
  const grid = document.querySelector('.store-grid');
  const bar = document.getElementById('store-player');
  let audio = document.getElementById('store-audio');
  const status = document.getElementById('store-status');
  if (!dataEl || !grid || !bar || !audio) return;

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

  function card(s) {
    return grid.querySelector('.store-card[data-slug="' + s + '"]');
  }

  function markCards() {
    grid.querySelectorAll('.store-card').forEach(c => {
      const active = c.dataset.slug === slug;
      c.classList.toggle('is-active', active);
      c.classList.toggle('is-playing', active && !audio.paused);
      const btn = c.querySelector('.store-play');
      if (!btn) return;
      const playing = active && !audio.paused;
      const name = catalog[c.dataset.slug] ? catalog[c.dataset.slug].t : '';
      btn.setAttribute('aria-label', (playing ? 'pause ' : 'play ') + name);
    });
  }

  function syncToggle() {
    toggleBtn.classList.toggle('is-playing', !audio.paused);
    toggleBtn.setAttribute('aria-label', audio.paused ? 'resume playback' : 'pause playback');
    markCards();
  }

  // the label reads the setting, not the loaded source: a mode change lands on
  // the next track, so it names the quality the next load will use
  function paintQuality() {
    if (!qualityBtn) return;
    const lossless = streamPath() === '/s/';
    qModeEl.textContent = mode;
    qNowEl.textContent = ' · ' + (lossless ? 'flac' : '128k');
    qualityBtn.setAttribute(
      'aria-label',
      'streaming quality: ' + mode + ', ' +
      (lossless ? 'lossless' : '128 kbps') + ' now. ' + NEXT_ACTION[mode]
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
      handoff('/p/');
    }, Math.max(0, STALL_BUDGET - stalledMs));
  }

  function stallEnd() {
    if (stallStart) stalledMs += Date.now() - stallStart;
    stallStart = 0;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = 0;
  }

  // the end of the line for a source: nothing is playing and nothing is left
  // to try
  function reportLoadFailure() {
    stallReset();
    if (status) status.textContent = 'that preview didn’t load. try again in a moment.';
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
    if (!slug || currentPath === toPath) return;
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
      if (fromError) reportLoadFailure();
    }

    standby.addEventListener('canplay', done, { once: true });
    standby.addEventListener('error', failed, { once: true });
    // the element was cloned from a preload="none" tag, so a bare src assignment
    // would download nothing
    standby.preload = 'auto';
    standby.src = API + toPath + slug + '/' + trackNN;
  }

  function load(nextSlug, nextIndex, autoplay) {
    const rel = catalog[nextSlug];
    if (!rel) return;
    const total = rel.tr.length;
    if (nextIndex < 0 || nextIndex >= total) return;

    slug = nextSlug;
    index = nextIndex;
    const track = rel.tr[index];      // [trackNumber, title, seconds]
    const nn = track[0] < 10 ? '0' + track[0] : String(track[0]);

    trackNN = nn;
    retried = false;
    stallReset();
    startClear();        // a rapid skip re-arms the deadline below
    lastRunway = Infinity;
    lastBufEnd = -1;     // buffer readings don't carry across tracks
    handoffGen++;        // a handoff in flight is for the track being replaced
    clearEl(standby);    // and so is whatever it half-loaded
    currentPath = streamPath();
    // a promotion is spent the moment it lands: any later one needs fresh
    // evidence, and demoteCount survives so a re-stall backs off harder
    if (currentPath === '/s/' && promotable) {
      promotable = false;
      healthySince = 0;
    }
    audio.src = API + currentPath + slug + '/' + nn;
    if (autoplay && mode === 'auto' && currentPath === '/s/') {
      startTimer = setTimeout(() => {
        startTimer = 0;
        recordDemote();
        handoff('/p/', true);
      }, START_DEADLINE);
    }
    paintQuality();
    bar.hidden = false;

    const c = card(slug);
    const img = c ? c.querySelector('img') : null;
    artEl.src = img ? img.currentSrc || img.src : '';
    releaseEl.textContent = rel.t;
    trackEl.textContent = total > 1
      ? nn + ' / ' + total + ' · ' + track[1]
      : track[1];

    const dur = track[2] || 0;
    scrub.max = String(Math.max(1, Math.round(dur)));
    scrub.value = '0';
    timeEl.textContent = '0:00 / ' + clock(dur);
    scrub.setAttribute('aria-valuetext', '0:00 of ' + clock(dur));

    prevBtn.disabled = total < 2 || index === 0;
    nextBtn.disabled = total < 2 || index === total - 1;

    if (autoplay) {
      const p = audio.play();
      if (p && p.catch) p.catch(() => syncToggle());
    }
    syncToggle();
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
    lastRunway = Infinity;
    handoffGen++;
    clearEl(audio);
    clearEl(standby);
    slug = null;
    bar.hidden = true;
    markCards();
  }

  grid.addEventListener('click', e => {
    const play = e.target.closest ? e.target.closest('.store-play') : null;
    if (play) {
      const s = play.dataset.slug;
      unlockStandby();
      if (s === slug) {
        if (audio.paused) {
          const p = audio.play();
          if (p && p.catch) p.catch(() => syncToggle());
        } else {
          audio.pause();
        }
        syncToggle();
      } else {
        load(s, 0, true);
      }
      return;
    }

    const buy = e.target.closest ? e.target.closest('.store-buy') : null;
    if (buy) checkout(buy);
  });

  function checkout(btn) {
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true');
    if (status) status.textContent = '';
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
        if (status) {
          status.textContent =
            'checkout didn’t open. try again, or email matthewjamisonmusicinquiries@gmail.com';
        }
      });
  }

  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  stopBtn.addEventListener('click', stop);
  toggleBtn.addEventListener('click', () => {
    if (!slug) return;
    unlockStandby();
    if (audio.paused) {
      const p = audio.play();
      if (p && p.catch) p.catch(() => syncToggle());
    } else {
      audio.pause();
    }
    syncToggle();
  });

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
  bindBoth('pause', () => { stallEnd(); startClear(); syncToggle(); });
  bindBoth('waiting', stallBegin);
  bindBoth('stalled', stallBegin);
  bindBoth('playing', () => { stallEnd(); startClear(); });
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
      handoff('/p/');
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
    if (currentPath !== '/p/' || !slug || audio.paused) return;
    const now = Date.now();
    if (now - lastSample < SAMPLE_EVERY) return;
    const elapsedSec = lastSample ? (now - lastSample) / 1000 : 0;
    lastSample = now;

    const t = audio.currentTime;
    const end = bufferedEnd(t);
    const dur = audio.duration;
    const whole = end >= 0 && dur && isFinite(dur) && end >= dur - 0.5;
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
    if (probing) return;
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
      handoff('/p/', true, true);
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
})();

// smooth scroll for nav links
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  });
});

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
  const controlsEl = document.getElementById('game-overlay-controls');
  const errorEl = document.getElementById('game-error');
  const retryBtn = document.getElementById('game-retry');
  const errorCloseBtn = document.getElementById('game-error-close');
  const musicDialog = document.getElementById('game-music-dialog');
  const keepBtn = document.getElementById('game-music-keep');
  const gameAudioBtn = document.getElementById('game-music-game');
  // the store player runs two audio elements (gapless quality handoff), and
  // which one is active changes at runtime — always check both
  const storeAudioEls = () => document.querySelectorAll('#store-player audio');
  if (!grid || !overlay || !frameHost || !closeBtn) return;

  const LOAD_BUDGET = 10000;  // ms before the plain retry/close state shows

  let open = null;      // { tile, slug, muted, scrollY } while open
  let loadTimer = 0;
  let mountSeq = 0;     // only the newest mount attempt may append an iframe
  let preflight = null;  // AbortController for the in-flight game-url preflight
  let pendingTile = null;  // tile awaiting the music dialog's answer
  let suppressPop = false;  // swallows the popstate our own history.back() will fire

  function musicPlaying() {
    return Array.prototype.some.call(
      storeAudioEls(), a => a.currentSrc && !a.paused
    );
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

  // trailing slash, not /index.html — the edge 308s the file form to this one
  // (query preserved), so pinning it here saves a redirect on every open
  function gameUrl() {
    return '/games/' + open.slug + '/' + (open.muted ? '?mjmute=1' : '');
  }

  function buildFrame() {
    const iframe = document.createElement('iframe');
    iframe.src = gameUrl();
    iframe.title = open.tile.dataset.name;
    // same-origin documentation only — not a security boundary here
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock allow-popups');
    iframe.addEventListener('load', () => {
      clearTimeout(loadTimer);
      loadTimer = 0;
      errorEl.hidden = true;
      try {
        // element focus, NOT contentWindow.focus() — focusing the subframe window
        // during the fullscreen-enter settle window makes Chrome abort fullscreen
        // (deployed-latency race); iframe.focus() delivers keys to the frame without that
        iframe.focus();
        // Escape inside the game must still close the overlay; keydown in
        // the iframe never bubbles to the parent, so listen there directly
        iframe.contentDocument.addEventListener('keydown', e => {
          if (e.key === 'Escape') closeGame(false);
        });
      } catch (e) { /* frame gone mid-load */ }
    });
    return iframe;
  }

  // preflight the URL before mounting: a missing game answers 404 in
  // milliseconds, so the error state shows at once instead of after the
  // LOAD_BUDGET stall (an iframe 404 fires `load`, not `error`). The timer
  // stays as the backstop for a game that answers 200 and then hangs.
  function mountFrame() {
    const seq = ++mountSeq;
    while (frameHost.firstChild) frameHost.removeChild(frameHost.firstChild);
    errorEl.hidden = true;
    clearTimeout(loadTimer);
    loadTimer = setTimeout(showError, LOAD_BUDGET);
    // stale guard: `open` goes null on close, and seq moves on a reopen or a
    // second retry — either way an in-flight preflight must not mount
    const live = () => open && seq === mountSeq;
    // a superseded preflight is cancelled, not just ignored — a closed overlay
    // should not keep a request open
    if (preflight) preflight.abort();
    preflight = new AbortController();
    // `no-cache`, not `no-store`: revalidate so a game pulled from the deploy
    // still reports 404, but keep the response cacheable so the iframe reuses
    // it instead of fetching the same HTML a second time
    fetch(gameUrl(), {
      method: 'GET',
      cache: 'no-cache',
      credentials: 'same-origin',
      signal: preflight.signal
    }).then(res => {
      if (!live()) return;
      if (!res.ok) { showError(); return; }
      frameHost.appendChild(buildFrame());
    }).catch(err => {
      if (err && err.name === 'AbortError') return;  // we cancelled it
      if (live()) showError();   // offline / DNS — same dead end for the player
    });
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
    creditEl.textContent = ' · game by ' + tile.dataset.author;
    controlsEl.textContent = tile.dataset.controls || '';
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
    if (preflight) { preflight.abort(); preflight = null; }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { /* already leaving */ });
    }
    while (frameHost.firstChild) frameHost.removeChild(frameHost.firstChild);
    controlsEl.textContent = '';
    errorEl.hidden = true;
    overlay.hidden = true;
    setInertBackground(false);
    document.body.classList.remove('game-locked');
    window.scrollTo(0, closed.scrollY);
    // preventScroll: focus() would otherwise scroll the tile into view and
    // override the restored position — scrollY is the source of truth here
    closed.tile.focus({ preventScroll: true });
    if (!fromPopstate && history.state && history.state.mjGame) {
      // history.back() fires popstate asynchronously — a fast close→reopen would
      // otherwise let that deferred event arrive and close the new game
      suppressPop = true;
      history.back();
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
    storeAudioEls().forEach(a => a.pause());
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
    if (suppressPop) { suppressPop = false; return; }
    if (open) closeGame(true);
  });

  // clicking overlay chrome hands focus back to the game
  overlay.addEventListener('pointerdown', e => {
    if (closeBtn.contains(e.target) || errorEl.contains(e.target)) return;
    const iframe = frameHost.querySelector('iframe');
    if (iframe) { iframe.focus(); }
  });
})();
