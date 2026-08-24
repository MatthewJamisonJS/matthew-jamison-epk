/* mj-mute.js — vendored as the FIRST script in each game's index.html.
   Inert unless the page URL carries ?mjmute=1 (appended by the parent EPK
   page when the visitor chose to keep their catalog music playing).
   Must run before any game code: it silences both audio paths a game can
   take — HTMLMediaElement and Web Audio — before either is first used. */
(function () {
  'use strict';
  if (!/[?&]mjmute=1(?:&|$)/.test(window.location.search)) return;

  /* media elements: force the ENGINE's muted flag through the native
     setters (shadowing the getter alone would only lie to JS while audio
     kept playing). Reads are pinned; writes are redirected to muted=true,
     volume=0 via the captured native descriptors. */
  var proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (proto) {
    var origPlay = proto.play;
    var mutedDesc = Object.getOwnPropertyDescriptor(proto, 'muted');
    var volumeDesc = Object.getOwnPropertyDescriptor(proto, 'volume');
    function forceMute(el) {
      try {
        if (mutedDesc && mutedDesc.set) mutedDesc.set.call(el, true);
        if (volumeDesc && volumeDesc.set) volumeDesc.set.call(el, 0);
      } catch (e) { /* detached or foreign element */ }
    }
    proto.play = function () {
      forceMute(this);
      return origPlay.apply(this, arguments);
    };
    try {
      Object.defineProperty(proto, 'muted', {
        configurable: true,
        get: function () { return true; },
        set: function () { forceMute(this); }
      });
      Object.defineProperty(proto, 'volume', {
        configurable: true,
        get: function () { return 0; },
        set: function () { forceMute(this); }
      });
    } catch (e) { /* accessors locked — the play() patch still mutes */ }

    /* <audio autoplay> in markup never calls play() from JS — sweep the
       document once it exists, and watch for elements added later */
    function sweep(root) {
      var list = root.querySelectorAll ? root.querySelectorAll('audio, video') : [];
      for (var i = 0; i < list.length; i++) forceMute(list[i]);
    }
    document.addEventListener('DOMContentLoaded', function () {
      sweep(document);
      new MutationObserver(function (muts) {
        for (var m = 0; m < muts.length; m++) {
          var added = muts[m].addedNodes;
          for (var n = 0; n < added.length; n++) {
            var node = added[n];
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'AUDIO' || node.tagName === 'VIDEO') forceMute(node);
            else sweep(node);
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  /* Web Audio: every context's destination becomes a zero-gain proxy, so
     whatever the game connects to "ctx.destination" is silenced. The real
     destination is wired up before the getter is shadowed. */
  function silenced(Ctor) {
    if (typeof Ctor !== 'function') return Ctor;
    function MutedCtx() {
      var ctx = arguments.length
        ? new Ctor(arguments[0])
        : new Ctor();
      var mute = ctx.createGain();
      mute.gain.value = 0;
      mute.connect(ctx.destination);
      try {
        Object.defineProperty(ctx, 'destination', {
          configurable: true,
          get: function () { return mute; }
        });
      } catch (e) { /* non-configurable — media-element pinning still holds */ }
      return ctx;
    }
    MutedCtx.prototype = Ctor.prototype;
    return MutedCtx;
  }
  window.AudioContext = silenced(window.AudioContext);
  window.webkitAudioContext = silenced(window.webkitAudioContext);
})();
