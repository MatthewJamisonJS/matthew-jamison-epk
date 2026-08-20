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
  const grid = document.querySelector('.catalog-grid');
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
