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
