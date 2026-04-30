// bio tab toggle
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.bio-content').forEach(c => c.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById('bio-' + tab).classList.remove('hidden');
  });
});

// hide video placeholder when video loads successfully
function initVideoPlaceholder(videoId, placeholderId) {
  const vid = document.getElementById(videoId);
  const ph = document.getElementById(placeholderId);
  if (!vid || !ph) return;
  vid.addEventListener('canplay', () => { ph.style.display = 'none'; });
  vid.addEventListener('error', () => { ph.style.display = 'flex'; vid.style.display = 'none'; });
}

initVideoPlaceholder('hero-video', 'hero-placeholder');
initVideoPlaceholder('live-video', 'live-placeholder');

// smooth scroll for nav links
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});
