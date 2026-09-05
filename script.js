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
  const infoBtn = document.getElementById('game-info-btn');
  const infoPanel = document.getElementById('game-info-panel');
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

  // ⓘ note: only tiles carrying data-info get the button. The panel starts
  // collapsed on every open, so a note left open on one game can't bleed into
  // the next. textContent, never innerHTML — Trusted Types is enforced here.
  function setInfo(text) {
    if (!infoBtn || !infoPanel) return;
    infoPanel.textContent = text || '';
    infoPanel.hidden = true;
    infoBtn.setAttribute('aria-expanded', 'false');
    infoBtn.hidden = !text;
  }

  function toggleInfo() {
    if (!infoBtn || !infoPanel) return;
    const nowOpen = infoPanel.hidden;
    infoPanel.hidden = !nowOpen;
    infoBtn.setAttribute('aria-expanded', String(nowOpen));
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
    setInfo(tile.dataset.info || '');
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
    setInfo('');
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

  if (infoBtn) infoBtn.addEventListener('click', toggleInfo);

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
    // the ⓘ button and its panel are chrome the visitor is reading — handing
    // focus back to the game mid-click would collapse the note they just opened
    if ((infoBtn && infoBtn.contains(e.target)) ||
        (infoPanel && infoPanel.contains(e.target))) return;
    const iframe = frameHost.querySelector('iframe');
    if (iframe) { iframe.focus(); }
  });
})();
