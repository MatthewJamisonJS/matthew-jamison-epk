// The subscribe form. One implementation, loaded by both the home page and
// every blog page, so the two can never drift apart.
//
// The CSP sets form-action 'none': a <form> here cannot navigate anywhere, so
// the submit is intercepted and the address is POSTed to the Worker with
// fetch, exactly like the checkout hand-off in script.js. Trusted Types is
// enforced sitewide, so every status line goes through textContent.
//
// The Worker answers 202 for every outcome that is not malformed — a honeypot
// hit, a rate-limited IP, a typo and a fresh signup are deliberately
// indistinguishable from out here. So "2xx" is the only success test there is.
(function () {
  var API = 'https://api.matthewjamison.dev';

  var OK = 'check your inbox (spam folders too) - click and confirm so we can stay tapped in';
  var FAIL = 'that didn\'t work. try again or email me';

  document.querySelectorAll('form.subscribe').forEach(function (form) {
    var email = form.querySelector('input[type="email"]');
    var honeypot = form.querySelector('input[name="website"]');
    var button = form.querySelector('button[type="submit"]');
    var status = form.querySelector('.subscribe-status');
    if (!email || !button || !status) return;

    function say(msg, bad) {
      status.textContent = msg;
      status.classList.toggle('is-error', !!bad);
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (button.getAttribute('aria-busy') === 'true') return;

      var value = email.value.trim();
      // novalidate is on the form so the browser's own bubble never fires;
      // checkValidity still reads the type + required, which is enough to
      // catch a typo before it costs a round trip.
      if (!value || !email.checkValidity()) {
        say('that address doesn’t look right — check it and try again', true);
        email.focus();
        return;
      }

      button.setAttribute('aria-busy', 'true');
      button.disabled = true;
      say('');

      fetch(API + '/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, website: honeypot ? honeypot.value : '' })
      })
        .then(function (r) {
          if (!r.ok) throw new Error(String(r.status));
          say(OK, false);
          form.reset();
        })
        .catch(function () {
          say(FAIL, true);
        })
        .then(function () {
          button.removeAttribute('aria-busy');
          button.disabled = false;
        });
    });
  });
})();
