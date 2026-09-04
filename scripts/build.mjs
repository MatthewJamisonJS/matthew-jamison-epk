#!/usr/bin/env node
// Content-layer generator.
//
//   node scripts/build.mjs [--out <dir>]
//
// Reads data/releases.json and emits, into <dir> (default: the repo root):
//
//   music/<slug>/index.html   one page per release
//   music/index.html          the hub crawlers land on
//   sitemap.xml               regenerated: / + /music/ + every release
//
// Zero npm dependencies, Node >= 20. It runs at deploy time BEFORE the sed
// that stamps ?v=dev with the commit SHA, so generated pages get versioned
// asset URLs like the hand-written ones. Output is not committed (music/ is
// gitignored); sitemap.xml is, because robots.txt points at it and reviewers
// diff it.
//
// Phase 2 (blog) extends this file: same shell(), same sitemap writer.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://matthewjamison.dev';
// The Person node itself is defined once, in index.html's @graph. A release
// page carries the @id plus enough of a stub (@type + name) to stand on its
// own for a consumer that only ever parses this one URL.
const PERSON_ID = `${SITE}/#matthew-jamison`;
const ARTIST = { '@id': PERSON_ID, '@type': 'Person', name: 'Matthew Jamison' };

const argOut = process.argv.indexOf('--out');
const OUT = argOut === -1 ? ROOT : resolve(process.argv[argOut + 1]);

const releases = JSON.parse(readFileSync(join(ROOT, 'data', 'releases.json'), 'utf8'));

// ── helpers ──────────────────────────────────────────────────────────────
const esc = s =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

// m:ss for the reader.
const clock = sec => {
  const t = Math.round(sec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

// ISO 8601 for schema.org.
const iso8601 = sec => {
  const t = Math.round(sec);
  const m = Math.floor(t / 60);
  const s = t % 60;
  return 'PT' + (m ? `${m}M` : '') + (s || !m ? `${s}S` : '');
};

const money = n => `$${n.toFixed(2)}`;

// schema.org MusicAlbumReleaseType. A "kind" of ep/single/album is the only
// vocabulary data/releases.json uses; sample packs are not seeded (they are
// not MusicAlbums and they live in #samples, not #catalog).
const RELEASE_TYPE = {
  single: 'https://schema.org/SingleRelease',
  ep: 'https://schema.org/EPRelease',
  album: 'https://schema.org/AlbumRelease'
};

// The templated meta description when Matthew has not written a blurb.
const description = r =>
  r.blurb ||
  (r.tracks.length === 1
    ? `${r.title} — a single by matthew jamison, st. louis session bassist + producer. buy direct.`
    : `${r.title} — a ${r.tracks.length}-track ${r.kind} by matthew jamison, st. louis session bassist + producer. buy direct.`);

const cover = (slug, size) => `/assets/covers/${slug}-${size}.webp`;

// ── page shell ───────────────────────────────────────────────────────────
// Mirrors thanks/index.html: url-bar, .page-orb, <main><section class="section">,
// footer. No <style>, no inline executable <script>, no style= — the CSP has no
// 'unsafe-inline' and requires Trusted Types.
const shell = ({ title, desc, canonical, ogImage, ogImageAlt, head = '', body, scripts = '' }) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="description" content="${esc(desc)}">
  <meta name="theme-color" content="#600675">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta property="og:image:alt" content="${esc(ogImageAlt)}">
  <meta property="og:type" content="${canonical === `${SITE}/music/` ? 'website' : 'music.album'}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta name="twitter:card" content="summary_large_image">
  <title>${esc(title)}</title>
  <link rel="canonical" href="${esc(canonical)}">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/assets/fonts/jetbrains-mono-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/style.css?v=dev">
${head}</head>
<body>

  <!-- CSS-only background: these pages ship no starfield, so the orb gradient
       stands on its own, same as /thanks/. -->
  <div class="page-orb" aria-hidden="true"></div>

  <!-- url-bar -->
  <div class="url-bar">
    <span class="comment">// Matthew Jamison &nbsp;·&nbsp; EPK &nbsp;·&nbsp; 2026</span>
  </div>

  <main>
${body}  </main>

  <!-- footer -->
  <footer class="footer">
    <p class="accent footer-peace">peace and long life to you and yours🖖🏿🤎</p>
    <div class="footer-links">
      <a href="/">home</a>
      <a href="/music/">releases</a>
      <a href="https://github.com/MatthewJamisonJS" target="_blank" rel="noopener">github</a>
      <a href="https://matthewjamisonwwjd.substack.com" target="_blank" rel="noopener">substack</a>
    </div>
    <p class="footer-copy">matthew jamison &nbsp;·&nbsp; epk &nbsp;·&nbsp; 2026</p>
  </footer>
${scripts}
</body>
</html>
`;

// ── release page ─────────────────────────────────────────────────────────
function releaseJsonLd(r) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'MusicAlbum',
    '@id': `${SITE}/music/${r.slug}/#album`,
    name: r.title,
    url: `${SITE}/music/${r.slug}/`,
    albumReleaseType: RELEASE_TYPE[r.kind],
    numTracks: r.tracks.length,
    image: SITE + cover(r.slug, 700),
    byArtist: ARTIST,
    genre: 'Instrumental',
    track: {
      '@type': 'ItemList',
      numberOfItems: r.tracks.length,
      itemListElement: r.tracks.map(t => ({
        '@type': 'MusicRecording',
        position: t.n,
        name: t.title,
        duration: iso8601(t.seconds),
        byArtist: { '@id': PERSON_ID }
      }))
    },
    offers: {
      '@type': 'Offer',
      price: r.price.toFixed(2),
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${SITE}/music/${r.slug}/`
    }
  };
  if (r.released) ld.datePublished = r.released;
  if (r.blurb) ld.description = r.blurb;
  if (r.credits && r.credits.length) {
    ld.contributor = r.credits.map(c => ({ '@type': 'Person', name: c }));
  }
  return ld;
}

function releasePage(r) {
  const tracks = r.tracks
    .map(
      // the number comes from the data, not a CSS counter: the player zero-pads
      // the same way ("01 / 13 · Dawn"), and a capped tracklist must not be
      // renumbered by the stylesheet into disagreeing with what was sold.
      t => `        <li>
          <span class="track-num muted">${String(t.n).padStart(2, '0')}</span>
          <span class="track-name">${esc(t.title)}</span>
          <span class="track-time muted">${clock(t.seconds)}</span>
        </li>`
    )
    .join('\n');

  const credits =
    r.credits && r.credits.length
      ? `
      <p class="section-note">credits: ${r.credits.map(esc).join(' &nbsp;·&nbsp; ')}</p>`
      : '';

  const blurb = r.blurb ? `\n        <p class="release-blurb">${esc(r.blurb)}</p>` : '';
  const date = r.released
    ? `\n        <p class="release-date muted">released <time datetime="${esc(r.released)}">${esc(r.released)}</time></p>`
    : '';

  const body = `    <section class="section" aria-label="${esc(r.title)}">
      <h2 class="section-label comment">// matthew jamison &nbsp;·&nbsp; releases</h2>

      <div class="release-head">
        <img class="release-art"
             src="${cover(r.slug, 350)}"
             srcset="${cover(r.slug, 350)} 350w,
                     ${cover(r.slug, 700)} 700w"
             sizes="(max-width: 700px) 240px, 280px"
             alt="${esc(r.title)} cover art" width="350" height="350"
             fetchpriority="high" decoding="async">

        <div class="release-intro">
          <h1 class="release-title">${esc(r.title)}</h1>
          <p class="store-meta">${esc(r.kind)}<span class="muted">&nbsp;·&nbsp;</span>${money(r.price)}<span class="muted">&nbsp;·&nbsp;</span>${r.tracks.length} ${r.tracks.length === 1 ? 'track' : 'tracks'}</p>${blurb}${date}
          <p class="release-actions">
            <button type="button" class="btn release-buy" data-slug="${esc(r.slug)}" aria-label="buy ${esc(r.title)} for ${money(r.price)}">→ buy</button>
          </p>
          <p class="release-status" id="release-status" role="status" aria-live="polite"></p>
        </div>
      </div>

      <ol class="release-tracks">
${tracks}
      </ol>${credits}

      <div class="catalog-more">
        <a href="/#catalog" class="btn-ghost">← all releases</a>
      </div>
    </section>
`;

  return shell({
    title: `${r.title} · matthew jamison`,
    desc: description(r),
    canonical: `${SITE}/music/${r.slug}/`,
    ogImage: SITE + cover(r.slug, 700),
    ogImageAlt: `${r.title} cover art`,
    head: `  <script type="application/ld+json">
${JSON.stringify(releaseJsonLd(r), null, 2)}
  </script>
`,
    body,
    scripts: `  <script src="/release.js?v=dev" defer></script>`
  });
}

// ── hub ──────────────────────────────────────────────────────────────────
function hubPage() {
  const cards = releases
    .map(
      r => `          <article class="store-card">
            <div class="store-art">
              <img src="${cover(r.slug, 350)}"
                   srcset="${cover(r.slug, 210)} 210w,
                           ${cover(r.slug, 350)} 350w,
                           ${cover(r.slug, 700)} 700w"
                   sizes="(max-width: 768px) calc(50vw - 43px), 289px"
                   alt="" width="350" height="350" loading="lazy" decoding="async">
            </div>
            <h2 class="store-title"><a href="/music/${esc(r.slug)}/">${esc(r.title)}</a></h2>
            <p class="store-meta">${esc(r.kind)}<span class="muted">&nbsp;·&nbsp;</span>${money(r.price)}</p>
          </article>`
    )
    .join('\n');

  const body = `    <section class="section" aria-label="releases">
      <h2 class="section-label comment">// every release &nbsp;·&nbsp; ${releases.length} of them &nbsp;·&nbsp; preview + buy on the store</h2>
      <h1 class="release-title release-title-hub">releases</h1>
      <div class="store-grid">
${cards}
      </div>

      <div class="catalog-more">
        <a href="/#catalog" class="btn-ghost">← back to the store</a>
      </div>
    </section>
`;

  return shell({
    title: 'releases · matthew jamison',
    desc: `every matthew jamison release — ${releases.length} instrumental albums, eps and singles from a st. louis session bassist + producer. buy direct.`,
    canonical: `${SITE}/music/`,
    ogImage: `${SITE}/assets/og-cover.jpg`,
    ogImageAlt: 'matthew jamison album cover art',
    body
  });
}

// ── sitemap ──────────────────────────────────────────────────────────────
// Hand-maintained facts that survive regeneration: /thanks/ stays out (it is a
// post-purchase receipt), and / keeps its three bass-sample cover entries.
const TODAY = new Date().toISOString().slice(0, 10);

function sitemap() {
  const home = `  <url>
    <loc>${SITE}/</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
    <!-- the three bass sample pack covers. 700px is the largest variant that
         ships; the 1200px size is deliberately not built. -->
    <image:image>
      <image:loc>${SITE}/assets/covers/infinity-loops-700.webp</image:loc>
      <image:title>infinity loops</image:title>
      <image:caption>over 50 original bass grooves</image:caption>
    </image:image>
    <image:image>
      <image:loc>${SITE}/assets/covers/bass-latin-vol-1-700.webp</image:loc>
      <image:title>bass sample pack vol. 1 [latin edition]</image:title>
      <image:caption>91 bass fills, 47 one shots, 18 slides &amp; more</image:caption>
    </image:image>
    <image:image>
      <image:loc>${SITE}/assets/covers/bass-samples-bundle-700.webp</image:loc>
      <image:title>the bundle</image:title>
      <image:caption>infinity loops + bass sample pack vol. 1 [latin edition]</image:caption>
    </image:image>
  </url>`;

  const hub = `  <url>
    <loc>${SITE}/music/</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;

  const rels = releases
    .map(
      r => `  <url>
    <loc>${SITE}/music/${r.slug}/</loc>
    <lastmod>${r.released || TODAY}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.7</priority>
    <image:image>
      <image:loc>${SITE}${cover(r.slug, 700)}</image:loc>
      <image:title>${esc(r.title)}</image:title>
      <image:caption>${esc(r.kind)} by matthew jamison</image:caption>
    </image:image>
  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED by scripts/build.mjs — edit data/releases.json, not this file.
     /thanks/ is deliberately absent: it is a post-purchase receipt page, only
     reachable from a Stripe redirect, with nothing to index. It carries
     <meta name="robots" content="noindex, follow"> for the same reason. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${home}
${hub}
${rels}
</urlset>
`;
}

// ── write ────────────────────────────────────────────────────────────────
const write = (rel, content) => {
  const path = join(OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

for (const r of releases) write(join('music', r.slug, 'index.html'), releasePage(r));
write(join('music', 'index.html'), hubPage());
write('sitemap.xml', sitemap());

console.log(`built ${releases.length} release pages + /music/ + sitemap.xml into ${OUT}`);
