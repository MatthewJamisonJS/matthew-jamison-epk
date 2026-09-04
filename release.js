// Release page buy button — the same Stripe hand-off the catalog uses.
//
// Lifted from the checkout() path in script.js (grid delegation and the
// preview player are not needed here, so only the fetch, the aria-busy state
// and the failure copy come across). Trusted Types is enforced sitewide:
// status text goes through textContent, never innerHTML.
(function () {
  const API = 'https://api.matthewjamison.dev';

  const btn = document.querySelector('.release-buy');
  if (!btn) return;
  const status = document.getElementById('release-status');

  function setStatus(msg) {
    if (status) status.textContent = msg;
  }

  btn.addEventListener('click', function () {
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
  });
})();


// Release page previews — a tracklist of play buttons plus the now-playing bar.
//
// A trimmed cousin of the store player in script.js: same API, same URL
// contract (/p/ = 128k mp3, /s/ = flac, both /<path>/<slug>/<NN>), same
// localStorage quality setting, the same bar component and the same glyphs.
// What is deliberately NOT here: the scrubber, the quality toggle, the standby
// element and the whole adaptive machine (stall clock, handoff, probe,
// hysteresis). One fallback rule stands in for all of it — an error on a /s/
// source retries that track once on /p/. script.js is coupled to the home DOM
// and is never loaded on these pages.
//
// Trusted Types is enforced sitewide: every write below is textContent,
// setAttribute or classList. No markup is ever assigned.
(function () {
  const API = 'https://api.matthewjamison.dev';
  const RESTART_AFTER = 3;  // seconds into a track before ⏮ restarts it

  const audio = document.getElementById('release-audio');
  const list = document.querySelector('.release-tracks');
  const bar = document.getElementById('release-player');
  if (!audio || !list || !bar) return;

  const buttons = Array.prototype.slice.call(list.querySelectorAll('.track-play'));
  if (!buttons.length) return;

  const nowEl = document.getElementById('release-now');
  const timeEl = document.getElementById('release-time');
  const prevBtn = document.getElementById('release-prev');
  const toggleBtn = document.getElementById('release-toggle');
  const nextBtn = document.getElementById('release-next');
  const artEl = bar.querySelector('.store-player-art');
  const albumEl = bar.querySelector('.store-player-release');
  const status = document.getElementById('release-status');

  function say(msg) {
    if (status) status.textContent = msg;
  }

  // quality: the same setting the home player writes, read once per load so a
  // change made on / lands here on the next track. There is no toggle on this
  // page — the player bar on / owns that control.
  const QUALITY_KEY = 'mj-stream-quality';
  const MODES = ['auto', 'lossless', 'saver'];
  const probe = document.createElement('audio');
  const canFlac = !!(probe.canPlayType && probe.canPlayType('audio/flac'));

  let mode = 'auto';
  try {
    const saved = localStorage.getItem(QUALITY_KEY);
    if (MODES.indexOf(saved) !== -1) mode = saved;
  } catch (e) { /* storage blocked — stay on auto */ }

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
    if (slowLink()) return '/p/';
    return canFlac ? '/s/' : '/p/';
  }

  let index = -1;       // position in `buttons` of the loaded track, -1 = idle
  let path = '/p/';     // the path that source was built from
  let retried = false;  // one /p/ retry per track, so an error can't loop

  function nameOf(i) {
    const el = buttons[i].closest('li').querySelector('.track-name');
    return el ? el.textContent : '';
  }

  // the printed duration, in seconds. The element knows once metadata lands;
  // until then the row's own m:ss is the better answer than 0:00.
  function fallbackSeconds(i) {
    const el = buttons[i].closest('li').querySelector('.track-time');
    if (!el) return 0;
    const parts = el.textContent.split(':');
    if (parts.length !== 2) return 0;
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  }

  function clock(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  // aria-disabled, not disabled: an end-stop control stays focusable and stays
  // announced, so a keyboard listener can still find the transport's shape.
  // Every handler checks it before acting.
  function setInert(btn, off) {
    btn.setAttribute('aria-disabled', off ? 'true' : 'false');
  }

  function inert(btn) {
    return btn.getAttribute('aria-disabled') === 'true';
  }

  // one painter for every state change: rows, buttons, labels and the bar can
  // never disagree, because nothing else writes them.
  function paint() {
    const sounding = index !== -1 && !audio.paused;

    buttons.forEach((btn, i) => {
      const row = btn.closest('li');
      const active = i === index;
      const on = active && sounding;
      if (row) {
        row.classList.toggle('is-active', active);
        row.classList.toggle('is-playing', on);
      }
      btn.classList.toggle('is-playing', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', (on ? 'pause ' : 'play ') + nameOf(i));
    });

    toggleBtn.classList.toggle('is-playing', sounding);
    toggleBtn.setAttribute('aria-label', sounding ? 'pause playback' : 'resume playback');

    // ⏮ has something to do while there is a track before this one OR enough
    // of this one has played for a restart to mean anything
    const canPrev = index > 0 || audio.currentTime > RESTART_AFTER;
    setInert(prevBtn, index === -1 || !canPrev);
    setInert(nextBtn, index === -1 || index >= buttons.length - 1);

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = sounding ? 'playing' : 'paused';
    }
  }

  function paintTime() {
    const dur = isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : fallbackSeconds(index === -1 ? 0 : index);
    timeEl.textContent = clock(audio.currentTime) + ' / ' + clock(dur);
  }

  // the bar is fixed, so while it is up it floats over the foot of the page.
  // body.store-open opens the matching runway under the footer and
  // --store-dock-h carries the measured height — the same contract the home
  // page's bar uses, and the same reason it can't be a constant (the bar is one
  // row on a desktop and three on a phone). setProperty writes a custom
  // property through the CSSOM; that is not a style attribute, and style-src
  // does not gate it.
  function showBar(on) {
    bar.hidden = !on;
    document.body.classList.toggle('store-open', on);
    if (on) {
      document.body.style.setProperty('--store-dock-h', bar.offsetHeight + 'px');
    } else {
      document.body.style.removeProperty('--store-dock-h');
    }
  }

  let sizeFrame = 0;
  window.addEventListener('resize', () => {
    if (bar.hidden || sizeFrame) return;
    sizeFrame = requestAnimationFrame(() => {
      sizeFrame = 0;
      if (!bar.hidden) {
        document.body.style.setProperty('--store-dock-h', bar.offsetHeight + 'px');
      }
    });
  });

  function start() {
    const p = audio.play();
    if (p && p.catch) p.catch(paint);
  }

  function load(i) {
    if (i < 0 || i >= buttons.length) return;
    const btn = buttons[i];
    index = i;
    retried = false;
    path = streamPath();
    say('');
    // the tag ships preload="none", so a bare src assignment would fetch nothing
    audio.preload = 'auto';
    audio.src = API + path + btn.dataset.slug + '/' + btn.dataset.track;

    const total = buttons.length;
    nowEl.textContent = total > 1
      ? btn.dataset.track + ' / ' + total + ' · ' + nameOf(i)
      : nameOf(i);

    setMetadata(i);
    showBar(true);
    start();
    paint();
    paintTime();
  }

  function toggle() {
    if (index === -1) return;
    if (audio.paused) start(); else audio.pause();
    paint();
  }

  // ⏮ is a restart before it is a skip — the same convention every transport
  // uses, and the reason it stays live on track one once the track is running.
  function prev() {
    if (inert(prevBtn)) return;
    if (audio.currentTime > RESTART_AFTER || index === 0) {
      audio.currentTime = 0;
      start();
      paint();
      return;
    }
    load(index - 1);
  }

  function next() {
    if (inert(nextBtn)) return;
    load(index + 1);
  }

  // lock screen, hardware keys and the OS media widget. No CSP surface: this is
  // an API call, not a resource load.
  function setMetadata(i) {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    const art = artEl ? artEl.currentSrc || artEl.src : '';
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: nameOf(i),
      artist: 'matthew jamison',
      album: albumEl ? albumEl.textContent : '',
      artwork: art ? [{ src: art, sizes: '210x210', type: 'image/webp' }] : []
    });
  }

  if ('mediaSession' in navigator) {
    const handlers = [
      ['play', () => { start(); paint(); }],
      ['pause', () => { audio.pause(); paint(); }],
      ['previoustrack', prev],
      ['nexttrack', next]
    ];
    handlers.forEach(([action, fn]) => {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch (e) { /* an engine that doesn't know this action — skip it */ }
    });
  }

  list.addEventListener('click', e => {
    const btn = e.target.closest ? e.target.closest('.track-play') : null;
    if (!btn) return;
    const i = buttons.indexOf(btn);
    if (i === index) { toggle(); return; }
    load(i);
  });

  prevBtn.addEventListener('click', prev);
  toggleBtn.addEventListener('click', toggle);
  nextBtn.addEventListener('click', next);

  audio.addEventListener('play', paint);
  audio.addEventListener('pause', paint);
  audio.addEventListener('loadedmetadata', paintTime);
  audio.addEventListener('timeupdate', () => {
    paintTime();
    // the restart/skip split flips at 3s, so ⏮ has to be re-evaluated as the
    // track runs — this is the only thing in paint() that time changes
    const canPrev = index > 0 || audio.currentTime > RESTART_AFTER;
    setInert(prevBtn, index === -1 || !canPrev);
  });

  // roll on, and stop at the end of the record rather than looping back
  audio.addEventListener('ended', () => {
    if (index !== -1 && index + 1 < buttons.length) {
      load(index + 1);
      return;
    }
    paint();
  });

  audio.addEventListener('error', () => {
    if (index === -1) return;
    if (path === '/s/' && !retried) {
      retried = true;
      path = '/p/';
      const btn = buttons[index];
      audio.src = API + path + btn.dataset.slug + '/' + btn.dataset.track;
      start();
      return;
    }
    say('that preview didn’t load. try again in a moment.');
    paint();
  });
})();
