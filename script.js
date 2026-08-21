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
      : '→ full catalog \u00a0·\u00a0 30 releases';
  });
})();

// store: one shared <audio> for 30 releases, plus Stripe checkout hand-off.
// Everything below builds DOM with createElement/textContent — the CSP has no
// 'unsafe-inline' and requires Trusted Types, so innerHTML is not available.
(function () {
  const API = 'https://api.matthewjamison.dev';
  const PLAY = '▶︎';   // ▶ forced to text presentation, not emoji
  const PAUSE = '▮▮';  // ▮▮

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

  let slug = null;   // release currently loaded in the bar
  let index = 0;     // 0-based position in that release's track list
  let scrubbing = false;

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
      const glyph = btn.querySelector('.store-glyph');
      const playing = active && !audio.paused;
      if (glyph) glyph.textContent = playing ? PAUSE : PLAY;
      const name = catalog[c.dataset.slug] ? catalog[c.dataset.slug].t : '';
      btn.setAttribute('aria-label', (playing ? 'pause preview of ' : 'play preview of ') + name);
    });
  }

  function syncToggle() {
    toggleBtn.textContent = audio.paused ? PLAY : PAUSE;
    toggleBtn.setAttribute('aria-label', audio.paused ? 'resume preview' : 'pause preview');
    markCards();
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

    audio.src = API + '/p/' + slug + '/' + nn;
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

  audio.addEventListener('play', syncToggle);
  audio.addEventListener('pause', syncToggle);
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
