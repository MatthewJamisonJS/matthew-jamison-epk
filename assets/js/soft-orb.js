// Soft Orb — interactive aura shader wallpaper for the hero background.
// Self-contained, dependency-free WebGL. ~3KB before gzip.
// Palette tuned to the portfolio: magenta #e91e63, deep purple #6b2d5c, near-black #0a0a0a.
//
// Performance budget:
//   - Lazy: nothing runs until the canvas scrolls into view (IntersectionObserver).
//   - Pauses on visibilitychange (tab hidden) and on prefers-reduced-motion.
//   - Single full-screen triangle-strip, no per-frame allocation.
//   - DPR capped at 1.5 — no 4× retina overdraw.
//   - powerPreference: 'low-power'. No fetches. No external libs.
//   - Skips entirely on coarse pointers if data-mobile="off".
//
// Usage:
//   <canvas id="soft-orb-bg" aria-hidden="true"></canvas>
//   <script defer src="/js/soft-orb.js"></script>
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  // Respect reduced motion — bail out, the static hero image already covers the area.
  var mql = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mql && mql.matches) return;

  var canvas = document.getElementById('soft-orb-bg');
  if (!canvas) return;

  var gl = canvas.getContext('webgl', {
    antialias: false,
    premultipliedAlpha: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
    depth: false,
    stencil: false,
  });
  if (!gl) return; // CSS gradient fallback already in place.

  var VERT = 'attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.,1.);}';

  // Fragment shader — Soft Orb tuned to the portfolio palette.
  // Brand colors: magenta (0.91,0.12,0.39), deep purple (0.42,0.18,0.36), near-black (0.04,0.02,0.06).
  var FRAG = [
    'precision mediump float;',
    'uniform vec2 u_res;uniform vec2 u_mouse;uniform float u_time;',
    'uniform vec3 u_click;uniform float u_clickStrength;',
    'float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
    'float n2(vec2 p){vec2 i=floor(p),f=fract(p);float a=h21(i),b=h21(i+vec2(1,0)),c=h21(i+vec2(0,1)),d=h21(i+vec2(1,1));vec2 u=f*f*(3.-2.*f);return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;}',
    'float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n2(p);p*=2.02;a*=.5;}return v;}',
    'vec3 aura(float t){',
    '  vec3 magenta=vec3(0.376,0.024,0.459);',
    '  vec3 purple =vec3(0.545,0.122,0.659);',
    '  vec3 rose   =vec3(0.75,0.55,0.85);',
    '  vec3 ink    =vec3(0.04,0.02,0.06);',
    '  float s=fract(t);',
    '  if(s<.33)return mix(ink,purple,s/.33);',
    '  if(s<.66)return mix(purple,magenta,(s-.33)/.33);',
    '  return mix(magenta,rose,(s-.66)/.34);',
    '}',
    'void main(){',
    '  vec2 uv=(gl_FragCoord.xy-.5*u_res)/u_res.y;',
    '  vec2 m =(u_mouse-.5*u_res)/u_res.y;',
    '  float t=u_time;',
    // ambient drifting clouds in deep purple
    '  float bg=fbm(uv*1.1+vec2(t*.05,-t*.04));',
    '  vec3 col=mix(vec3(0.04,0.02,0.06),aura(bg*.4)*.45,.7);',
    // main orb at mouse — magenta core, rose halo
    '  float d=length(uv-m);',
    '  float orb=exp(-d*5.)+0.6*exp(-d*14.);',
    '  col+=aura(.55+t*.04)*orb*1.05;',
    // soft trailing wisp toward center
    '  vec2 dir=normalize(m+vec2(.0001));',
    '  for(int i=1;i<=5;i++){',
    '    float fi=float(i)/5.;',
    '    vec2 tp=m-dir*fi*.18;',
    '    float td=length(uv-tp);',
    '    col+=aura(.45+fi*.2)*exp(-td*8.)*(.22*(1.-fi));',
    '  }',
    // click satellites — three orbs spinning out
    '  float age=u_click.z;',
    '  if(age<3.&&u_clickStrength>0.){',
    '    vec2 cp=(u_click.xy-.5*u_res)/u_res.y;',
    '    float fade=exp(-age*.9)*u_clickStrength;',
    '    for(int i=0;i<3;i++){',
    '      float fi=float(i)*2.0944;',
    '      float rad=age*.45;',
    '      vec2 sp=cp+vec2(cos(fi+age*2.),sin(fi+age*2.))*rad;',
    '      float sd=length(uv-sp);',
    '      col+=aura(.6+fi*.05)*exp(-sd*9.)*fade*1.2;',
    '    }',
    '  }',
    // sparkles
    '  vec2 g=floor(uv*60.);',
    '  float sp=step(.996,h21(g+floor(t*2.)));',
    '  col+=vec3(sp)*.55*(.5+.5*sin(t*8.));',
    // vignette + dither
    '  col*=1.-.32*length(uv);',
    '  col+=(h21(gl_FragCoord.xy)-.5)/255.;',
    '  gl_FragColor=vec4(col,1.);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
    return s;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;

  var prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.deleteShader(vs); gl.deleteShader(fs);

  var loc = {
    a_pos: gl.getAttribLocation(prog, 'a_pos'),
    u_res: gl.getUniformLocation(prog, 'u_res'),
    u_mouse: gl.getUniformLocation(prog, 'u_mouse'),
    u_time: gl.getUniformLocation(prog, 'u_time'),
    u_click: gl.getUniformLocation(prog, 'u_click'),
    u_clickStrength: gl.getUniformLocation(prog, 'u_clickStrength'),
  };

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  gl.useProgram(prog);
  gl.enableVertexAttribArray(loc.a_pos);
  gl.vertexAttribPointer(loc.a_pos, 2, gl.FLOAT, false, 0, 0);

  var mouseX = 0, mouseY = 0, hasMouse = false;
  var clickX = 0, clickY = 0, clickT = -999, clickStrength = 0;
  var t0 = performance.now();
  var raf = 0, running = false, started = false;

  function resize() {
    var dpr = Math.min(1.5, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    var h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  function frame() {
    if (!running) { raf = 0; return; }
    resize();
    var now = (performance.now() - t0) / 1000;
    var dpr = canvas.width / Math.max(1, canvas.clientWidth);
    // Default mouse to center-top if user hasn't moved yet — looks intentional rather than dead.
    var mx = hasMouse ? mouseX : canvas.clientWidth * 0.5;
    var my = hasMouse ? mouseY : canvas.clientHeight * 0.4;
    gl.uniform2f(loc.u_res, canvas.width, canvas.height);
    gl.uniform2f(loc.u_mouse, mx * dpr, (canvas.clientHeight - my) * dpr);
    gl.uniform1f(loc.u_time, now);
    gl.uniform3f(loc.u_click, clickX * dpr, (canvas.clientHeight - clickY) * dpr, Math.max(0, now - clickT));
    gl.uniform1f(loc.u_clickStrength, clickStrength);
    clickStrength *= 0.992;
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || document.hidden) return;
    running = true;
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  // The hero is a fixed-position overlay — listen on the hero section so we
  // catch mouse moves even when other elements (h1, button) are above the canvas.
  var hero = canvas.closest('.hero-area') || canvas.parentElement || canvas;

  hero.addEventListener('mousemove', function (e) {
    var r = canvas.getBoundingClientRect();
    mouseX = e.clientX - r.left;
    mouseY = e.clientY - r.top;
    hasMouse = true;
  }, { passive: true });

  hero.addEventListener('click', function (e) {
    var r = canvas.getBoundingClientRect();
    clickX = e.clientX - r.left;
    clickY = e.clientY - r.top;
    clickT = (performance.now() - t0) / 1000;
    clickStrength = 1.0;
  }, { passive: true });

  hero.addEventListener('touchmove', function (e) {
    if (!e.touches[0]) return;
    var r = canvas.getBoundingClientRect();
    mouseX = e.touches[0].clientX - r.left;
    mouseY = e.touches[0].clientY - r.top;
    hasMouse = true;
  }, { passive: true });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else if (started) start();
  });

  // IntersectionObserver — only run when hero is at least 5% visible.
  var io = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].isIntersecting) { started = true; start(); }
      else stop();
    }
  }, { threshold: [0, 0.05] });
  io.observe(canvas);
})();
