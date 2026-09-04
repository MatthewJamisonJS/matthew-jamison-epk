// Blog page behaviour: the author-card avatar under Reduce Motion, and the
// copy-link share cube. Nothing here is required for the page to read.
(function () {
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Reduce Motion: the avatar holds its poster instead of looping. Same rule
  // the hero video follows in script.js — the <source> children are removed
  // before load() so no bytes are fetched at all, and the poster is what a
  // <video> with no playable source shows.
  if (reducedMotion) {
    document.querySelectorAll('.author-card__photo').forEach(function (video) {
      if (video.tagName !== 'VIDEO') return;
      video.removeAttribute('autoplay');
      video.removeAttribute('loop');
      video.pause();
      video.querySelectorAll('source').forEach(function (s) { s.remove(); });
      try { video.load(); } catch (e) { /* nothing to reload; the poster stands */ }
    });
  }

  // The copy cube ships hidden and is revealed only where the Clipboard API
  // exists, so nobody meets a control that cannot work. The confirmation is a
  // visible live region, set with textContent — Trusted Types is enforced.
  if (!navigator.clipboard || !navigator.clipboard.writeText) return;

  document.querySelectorAll('.post-share__copy').forEach(function (button) {
    var status = button.closest('.post-share').querySelector('.post-share__status');
    var timer = 0;
    button.hidden = false;
    button.addEventListener('click', function () {
      navigator.clipboard.writeText(button.dataset.copyUrl).then(
        function () {
          button.classList.add('is-copied');
          if (status) status.textContent = button.dataset.copiedLabel || 'link copied';
          clearTimeout(timer);
          timer = setTimeout(function () {
            button.classList.remove('is-copied');
            if (status) status.textContent = '';
          }, 2000);
        },
        function () {
          if (status) status.textContent = 'couldn’t copy — the address bar has it';
        }
      );
    });
  });
})();
