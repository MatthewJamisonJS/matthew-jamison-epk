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

  function streamPath(s) {
    if (mp3Only(s)) return '/p/';
    if (mode === 'saver') return '/p/';
    if (mode === 'lossless') return canFlac ? '/s/' : '/p/';
    if ((demoteCount > 0 && !promotable) || slowLink()) return '/p/';
    return canFlac ? '/s/' : '/p/';
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
    const lossless = streamPath(slug) === '/s/';
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
    setStatus('that preview didn’t load. try again in a moment.');
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
    currentPath = streamPath(slug);
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
    lastRunway = Infinity;
    handoffGen++;
    clearEl(audio);
    clearEl(standby);
    slug = null;
    showBar(false);
    paintEnds();
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

  // the markup ships #store-toggle with .is-playing and "pause playback" so a
  // release bar reads correctly the instant a row is tapped. Nothing is loaded
  // yet at boot, so the label would otherwise lie until the first load(); the
  // bar is hidden either way, but the accessible name is not.
  paintEnds();
  syncToggle();
})();
