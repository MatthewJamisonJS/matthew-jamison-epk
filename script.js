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
  const STALL_BUDGET = 4000;  // ms of buffering before auto gives up on flac

  let mode = 'auto';
  try {
    const saved = localStorage.getItem(QUALITY_KEY);
    if (MODES.indexOf(saved) !== -1) mode = saved;
  } catch (e) { /* storage blocked — stay on auto */ }

  // once auto has been burned by a stall it stays on mp3 for the session,
  // otherwise a marginal connection flaps between the two sources
  let demoted = false;

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
    if (demoted || slowLink()) return '/p/';
    return canFlac ? '/s/' : '/p/';
  }

  const dataEl = document.getElementById('store-data');
  const grid = document.querySelector('.store-grid');
  const bar = document.getElementById('store-player');
  const audio = document.getElementById('store-audio');
  const status = document.getElementById('store-status');
  if (!dataEl || !grid || !bar || !audio) return;

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
      demoted = true;
      swapToMp3();
    }, Math.max(0, STALL_BUDGET - stalledMs));
  }

  function stallEnd() {
    if (stallStart) stalledMs += Date.now() - stallStart;
    stallStart = 0;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = 0;
  }

  // reload the same track from the mp3 source at the position it reached.
  // forcePlay covers the error path, where the element is already paused but
  // the listener still expects playback to continue.
  function swapToMp3(forcePlay) {
    if (!slug || currentPath === '/p/') return;
    const at = audio.currentTime;   // read before the src assignment resets it
    const wasPlaying = forcePlay || !audio.paused;
    stallReset();
    currentPath = '/p/';
    const src = API + '/p/' + slug + '/' + trackNN;
    audio.src = src;
    audio.addEventListener('loadedmetadata', () => {
      // a skip can land a different track before this fires — leave it alone
      if (audio.currentSrc !== src && audio.src !== src) return;
      try { audio.currentTime = at; } catch (e) { /* not seekable yet */ }
      if (wasPlaying) {
        const p = audio.play();
        if (p && p.catch) p.catch(() => syncToggle());
      }
    }, { once: true });
    paintQuality();
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
    currentPath = streamPath();
    audio.src = API + currentPath + slug + '/' + nn;
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
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    slug = null;
    bar.hidden = true;
    markCards();
  }

  grid.addEventListener('click', e => {
    const play = e.target.closest ? e.target.closest('.store-play') : null;
    if (play) {
      const s = play.dataset.slug;
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
      stallEnd();  // a pending demote belongs to the mode that armed it
      paintQuality();
    });
    paintQuality();
  }

  audio.addEventListener('play', syncToggle);
  audio.addEventListener('pause', () => { stallEnd(); syncToggle(); });
  audio.addEventListener('waiting', stallBegin);
  audio.addEventListener('stalled', stallBegin);
  audio.addEventListener('playing', stallEnd);
  audio.addEventListener('ended', () => {
    if (!slug) return;
    if (index < catalog[slug].tr.length - 1) step(1);
    else syncToggle();
  });

  audio.addEventListener('timeupdate', () => {
    if (scrubbing || !slug) return;
    const dur = audio.duration || catalog[slug].tr[index][2] || 0;
    scrub.value = String(Math.round(audio.currentTime));
    timeEl.textContent = clock(audio.currentTime) + ' / ' + clock(dur);
    scrub.setAttribute('aria-valuetext', clock(audio.currentTime) + ' of ' + clock(dur));
  });

  audio.addEventListener('loadedmetadata', () => {
    if (isFinite(audio.duration) && audio.duration > 0) {
      scrub.max = String(Math.round(audio.duration));
    }
  });

  audio.addEventListener('error', () => {
    // stop() clears the src, which fires error too — only report a real failure
    if (!slug) return;
    // a lossless source that fails outright gets one mp3 attempt before the
    // failure reaches the listener
    if (currentPath === '/s/' && !retried) {
      retried = true;
      swapToMp3(true);
      return;
    }
    stallReset();
    if (status) status.textContent = 'that preview didn’t load. try again in a moment.';
    syncToggle();
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
