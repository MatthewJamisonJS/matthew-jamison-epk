/* Exercises everything the overlay contract cares about:
   - window focus (keyboard games need it immediately)
   - keydown delivery (proves iframe focus, and gives Escape a live target)
   - pointer taps (touch pass-through)
   - both audio paths, with an on-page readout of whether they are muted */
(function () {
  'use strict';
  var focusValue = document.getElementById('focus-value');
  var keyValue = document.getElementById('key-value');
  var tapValue = document.getElementById('tap-value');
  var audioValue = document.getElementById('audio-value');
  var taps = 0;

  function paintFocus() {
    focusValue.textContent = document.hasFocus() ? 'yes' : 'no';
  }
  window.addEventListener('focus', paintFocus);
  window.addEventListener('blur', paintFocus);
  paintFocus();

  document.addEventListener('keydown', function (e) {
    keyValue.textContent = e.key;
  });

  document.addEventListener('pointerdown', function () {
    taps += 1;
    tapValue.textContent = String(taps);
  });

  document.getElementById('tone-btn').addEventListener('click', function () {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = new Ctx();
    var osc = ctx.createOscillator();
    osc.frequency.value = 440;
    osc.connect(ctx.destination);
    osc.start();
    setTimeout(function () { osc.stop(); ctx.close(); }, 800);
    /* the shim shadows ctx.destination with a zero-gain node; report it */
    var muted = !!(ctx.destination && ctx.destination.gain && ctx.destination.gain.value === 0);
    audioValue.textContent = muted ? 'web-audio MUTED' : 'web-audio audible';
  });

  document.getElementById('media-btn').addEventListener('click', function () {
    /* 0.5s of silence-shaped wav is enough to observe the muted property */
    var a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=');
    var p = a.play();
    if (p && p.catch) { p.catch(function () { /* autoplay policy — fine */ }); }
    audioValue.textContent = a.muted ? 'media MUTED' : 'media audible (muted=' + a.muted + ', volume=' + a.volume + ')';
  });
})();
