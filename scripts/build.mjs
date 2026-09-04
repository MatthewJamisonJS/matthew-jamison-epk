#!/usr/bin/env node
// Content-layer generator.
//
//   node scripts/build.mjs [--out <dir>] [--content <dir>]
//
// Reads data/releases.json and content/blog/*.md and emits, into <dir>
// (default: the repo root):
//
//   music/<slug>/index.html   one page per release
//   music/index.html          the hub crawlers land on
//   blog/<slug>/index.html    one page per published post
//   blog/index.html           the listing, paged at 10 (blog/page/N/)
//   feed.xml                  RSS 2.0, the 20 newest posts, full text
//   index.html                rewritten between the notes: markers only
//   sitemap.xml               regenerated: / + /music/ + /blog/ + everything
//
// --content points at the directory holding the post markdown (default
// content/blog). The tests pass a throwaway one so the repo's own content/
// stays empty.
//
// Zero npm dependencies, Node >= 20. It runs at deploy time BEFORE the sed
// that stamps ?v=dev with the commit SHA, so generated pages get versioned
// asset URLs like the hand-written ones. Output is not committed (music/ is
// gitignored); sitemap.xml is, because robots.txt points at it and reviewers
// diff it.
//
// Phase 2 (blog) extends this file: same shell(), same sitemap writer.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://matthewjamison.dev';
// The Person node itself is defined once, in index.html's @graph. A release
// page carries the @id plus enough of a stub (@type + name) to stand on its
// own for a consumer that only ever parses this one URL.
const PERSON_ID = `${SITE}/#matthew-jamison`;
const ARTIST = { '@id': PERSON_ID, '@type': 'Person', name: 'Matthew Jamison' };

const flag = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};
const OUT = flag('--out', ROOT);
const CONTENT = flag('--content', join(ROOT, 'content', 'blog'));

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
const shell = ({
  title,
  desc,
  canonical,
  ogImage,
  ogImageAlt,
  ogType,
  headLinks = '',
  head = '',
  body,
  scripts = ''
}) => `<!DOCTYPE html>
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
  <meta property="og:type" content="${ogType || (canonical === `${SITE}/music/` ? 'website' : 'music.album')}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta name="twitter:card" content="summary_large_image">
  <title>${esc(title)}</title>
  <link rel="canonical" href="${esc(canonical)}">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/assets/fonts/jetbrains-mono-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/style.css?v=dev">
${headLinks}${head}</head>
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

// ── blog: front matter ───────────────────────────────────────────────────
// A flat TOML reader for exactly the shape the writing kit emits (see
// ~/Code/mj-writing-room/.claude/rules/publishing.md): `key = value` at the top
// level, quoted strings, arrays of quoted strings, booleans, and BARE dates
// (`2026-09-04`, unquoted). No tables, no nested arrays, no multi-line strings
// — the kit never writes them, and a parser that pretends to support them would
// be a parser nobody has tested.
// The closing quote is the first UNESCAPED one. indexOf would stop at the
// backslash in `\"All About Love\"` and truncate the line — and he quotes
// constantly, so that is a live failure mode, not a hypothetical one.
function closingQuote(v) {
  for (let n = 1; n < v.length; n++) {
    if (v[n] === '\\') { n++; continue; }
    if (v[n] === '"') return n;
  }
  return -1;
}

function tomlScalar(raw) {
  const v = raw.trim();
  if (v.startsWith('"')) {
    const end = closingQuote(v);
    return v.slice(1, end === -1 ? v.length : end).replace(/\\(["\\])/g, '$1');
  }
  if (v.startsWith("'")) {
    const end = v.indexOf("'", 1);
    return v.slice(1, end === -1 ? v.length : end);
  }
  const bare = v.replace(/\s+#.*$/, '').trim();
  if (bare === 'true') return true;
  if (bare === 'false') return false;
  // a bare TOML date stays a string: every consumer here wants YYYY-MM-DD, and
  // turning it into a Date would drag the build machine's timezone in.
  if (/^\d{4}-\d{2}-\d{2}$/.test(bare)) return bare;
  if (/^-?\d+(\.\d+)?$/.test(bare)) return Number(bare);
  return bare;
}

function tomlArray(raw) {
  const inner = raw.trim().slice(1, raw.trim().lastIndexOf(']'));
  const items = [];
  let buf = '';
  let quote = '';
  for (const ch of inner) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === ',') { if (buf.trim()) items.push(tomlScalar(buf)); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) items.push(tomlScalar(buf));
  return items;
}

function parseFrontMatter(text) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  if (lines[0].trim() !== '+++') return null;
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '+++') { close = i; break; }
  }
  if (close === -1) return null;

  const meta = {};
  for (const line of lines.slice(1, close)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const value = t.slice(eq + 1).trim();
    meta[key] = value.startsWith('[') ? tomlArray(value) : tomlScalar(value);
  }
  return { meta, body: lines.slice(close + 1).join('\n') };
}

// ── blog: markdown ───────────────────────────────────────────────────────
// A deliberately small subset, rendered by hand rather than by a dependency:
// headings (with ids), paragraphs, em/strong, links, images, blockquote, ul,
// ol, code spans, fenced code, hr. Everything else is escaped text. There is
// NO raw-HTML passthrough — the CSP forbids inline style and Trusted Types
// forbids innerHTML, so a post that could smuggle markup through would be able
// to smuggle a policy violation with it.
const slugify = s =>
  s
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';

// Only these schemes reach an href/src. Everything else (javascript:, data:,
// vbscript:) renders as plain text rather than as a link.
const SAFE_URL = /^(https?:\/\/|mailto:|\/|#)/i;

// Intrinsic size straight out of the WebP header, so a cover never lands
// without width/height and shifts the card as it decodes. Three chunk layouts
// exist; all three are read here. Anything unreadable falls back to the
// 800x450 the kit is documented to produce.
function webpSize(file) {
  try {
    const b = readFileSync(file);
    if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') {
      return null;
    }
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') {
      const rd = o => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
      return { w: rd(24) + 1, h: rd(27) + 1 };
    }
  } catch { /* unreadable: fall through */ }
  return null;
}

// A site-absolute image path resolves against OUT first (that is where a cover
// copied in by the kit lands during a test run) and then the repo.
function siteImageSize(src) {
  if (!src.startsWith('/')) return null;
  for (const base of [OUT, ROOT]) {
    const file = join(base, src.slice(1));
    if (existsSync(file)) return webpSize(file);
  }
  return null;
}

function imgTag(src, alt, cls) {
  if (!SAFE_URL.test(src)) return esc(`![${alt}](${src})`);
  const size = siteImageSize(src);
  const dims = size ? ` width="${size.w}" height="${size.h}"` : '';
  return `<img${cls ? ` class="${cls}"` : ''} src="${esc(src)}" alt="${esc(alt)}"${dims} loading="lazy" decoding="async">`;
}

function linkTag(href, text) {
  if (!SAFE_URL.test(href)) return text;
  const external = /^https?:\/\//i.test(href) && !href.startsWith(SITE);
  return `<a href="${esc(href)}"${external ? ' rel="noopener noreferrer"' : ''}>${text}</a>`;
}

// Inline pass. The source is escaped FIRST, then the handful of markers are
// turned back into elements; backslash escapes, code spans, images and links
// are stashed behind NUL placeholders so emphasis never rewrites the inside of
// a code span, a URL, or a character he deliberately escaped. The placeholder
// byte cannot appear in the escaped text.
//
// Deliberately absent: any typographic transform. His quotes, ellipses, `&`,
// `#FrogAndToad`, `;-;` faces, emoji and `{ brace = definitions }` reach the
// page exactly as he typed them.
function inlineMd(src) {
  const stash = [];
  const keep = html => `\u0000${stash.push(html) - 1}\u0000`;
  let s = esc(src)
    // \_ \* \[ \] ... — the scrape is full of them (`\_update`, `\[the\]`)
    .replace(/\\([\\`*_{}[\]()#+\-.!>~])/g, (_, ch) => keep(ch))
    .replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`))
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => keep(imgTag(url, alt)))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => keep(linkTag(url, text)))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // `_italic_` is his default emphasis. The guards keep snake_case words and
    // `new_question` out of it — an underscore only opens emphasis when it is
    // not sitting between two word characters.
    .replace(/(^|[^A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[i]);
}

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|opus|flac)(\?|#|$)/i;
const YOUTUBE = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)\//i;

// The CSP has no frame-src, so a YouTube embed is impossible without widening
// the policy — a contract change nobody has approved. A lone YouTube link
// therefore renders as a link card carrying his own link text.
const linkCard = (href, text) =>
  `<p class="link-card"><a class="link-card__link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">` +
  `<span class="link-card__kind">watch on youtube</span>` +
  `<span class="link-card__label">${inlineMd(text)}</span></a></p>`;

const audioTag = src =>
  SAFE_URL.test(src)
    ? `<audio class="prose-audio" controls preload="none" src="${esc(src)}"></audio>`
    : `<p>${esc(src)}</p>`;

const BLOCK_START = /^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|~~~|(-{3,}|\*{3,}|_{3,})\s*$)/;

function renderMarkdown(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const headings = [];
  const seen = new Map();
  let i = 0;

  const listItems = (test, strip) => {
    const items = [];
    while (i < lines.length && test.test(lines[i])) {
      items.push(inlineMd(lines[i].replace(strip, '').trim()));
      i++;
    }
    return items;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = line.match(/^\s*(```|~~~)\s*(\S*)/);
    if (fence) {
      const close = fence[1];
      const info = fence[2].toLowerCase();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(close)) { buf.push(lines[i]); i++; }
      i++; // the closing fence
      // ```audio — one path per line. media-src is already 'self', so a clip
      // dropped in assets/blog/ plays with no policy change.
      if (info === 'audio') {
        out.push(buf.map(l => l.trim()).filter(Boolean).map(audioTag).join('\n'));
      } else {
        out.push(`<pre><code>${esc(buf.join('\n'))}\n</code></pre>`);
      }
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      // The page <h1> is the post title, so every heading in the BODY shifts
      // down one level: his `#` lines (`# March 12, 2026,`, `# ...`) become
      // <h2>, his `##` sections <h3>, his `###` subtitle <h4>. The outline
      // keeps exactly one <h1> per page.
      const level = Math.min(6, h[1].length + 1);
      const text = h[2].trim().replace(/\s+#+\s*$/, '');
      const base = slugify(text);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      const id = n === 1 ? base : `${base}-${n}`;
      out.push(`<h${level} id="${esc(id)}">${inlineMd(text)}</h${level}>`);
      if (level >= 2 && level <= 4) headings.push({ level, id, text });
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      // A quote keeps its own shape: a blank `>` line starts a new paragraph
      // (his James 1 and Psalm 46 passages are set that way), and a plain line
      // break inside one stays a line break.
      const paras = buf
        .join('\n')
        .split(/\n\s*\n/)
        .map(chunk => chunk.split('\n').map(l => l.trim()).filter(Boolean))
        .filter(rows => rows.length);
      const inner = paras.map(rows => `<p>${rows.map(inlineMd).join('<br>\n')}</p>`).join('\n');
      out.push(`<blockquote>\n${inner}\n</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = listItems(/^\s*[-*+]\s+/, /^\s*[-*+]\s+/);
      out.push(`<ul>\n${items.map(t => `<li>${t}</li>`).join('\n')}\n</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = listItems(/^\s*\d+[.)]\s+/, /^\s*\d+[.)]\s+/);
      out.push(`<ol>\n${items.map(t => `<li>${t}</li>`).join('\n')}\n</ol>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    for (const block of paragraphBlocks(para)) out.push(block);
  }

  return { html: mergeFigcaptions(out).join('\n'), headings };
}

// A run of consecutive non-blank lines. Inside it a LONE newline is a line
// break, not whitespace to collapse — the breath-line cadence ("pause /
// breathe / sit in silence & solitude… / & then") is the voice, and a
// commonmark paragraph would flatten it into one line.
function paragraphBlocks(para) {
  const blocks = [];
  let run = [];

  const flush = () => {
    if (!run.length) return;
    const rows = run;
    run = [];

    if (rows.length === 1) {
      const only = rows[0];

      // ![alt](file) — an image is a figure, and an audio file is a player.
      const media = only.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (media) {
        const [, alt, src] = media;
        blocks.push(
          AUDIO_EXT.test(src)
            ? audioTag(src)
            : `<figure class="prose-figure">${imgTag(src, alt)}</figure>`
        );
        return;
      }

      // a paragraph that is nothing but a YouTube link becomes a link card
      const link = only.match(/^\[([^\]]+)\]\((\S+)\)$/);
      if (link && YOUTUBE.test(link[2])) {
        blocks.push(linkCard(link[2], link[1]));
        return;
      }
    }

    blocks.push(`<p>${rows.map(inlineMd).join('<br>\n')}</p>`);
  };

  for (const line of para) {
    // The scrape leaves `[image] Title` where Substack had an uploaded image.
    // It is marked, not dropped: a visitor sees a muted placeholder and a
    // re-scrape is obviously still owed.
    const missing = line.match(/^\[image\]\s*(.*)$/i);
    if (missing) {
      flush();
      blocks.push(
        `<p class="img-missing">${missing[1] ? inlineMd(missing[1]) : 'image'}</p>`
      );
      continue;
    }
    run.push(line);
  }
  flush();
  return blocks;
}

// An italic line directly under a figure is its caption.
function mergeFigcaptions(blocks) {
  const merged = [];
  for (let n = 0; n < blocks.length; n++) {
    const cap = blocks[n + 1] && blocks[n + 1].match(/^<p><em>([\s\S]*)<\/em><\/p>$/);
    if (/^<figure class="prose-figure">/.test(blocks[n]) && cap) {
      merged.push(blocks[n].replace(/<\/figure>$/, `<figcaption>${cap[1]}</figcaption></figure>`));
      n++;
      continue;
    }
    merged.push(blocks[n]);
  }
  return merged;
}

// ── blog: posts ──────────────────────────────────────────────────────────
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// The site is lowercase, so is the date. Formatted from the ISO string rather
// than a Date, so a build machine's timezone can never shift a post a day.
const humanDate = iso => {
  const [y, m, d] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
};
const readingTime = body => Math.max(1, Math.ceil((body.trim().split(/\s+/).filter(Boolean).length) / 200));
const PER_PAGE = 10;
const FEED_ITEMS = 20;

function loadPosts() {
  if (!existsSync(CONTENT)) return [];
  const posts = [];
  for (const name of readdirSync(CONTENT).sort()) {
    if (!name.endsWith('.md') || name.startsWith('_')) continue;
    const parsed = parseFrontMatter(readFileSync(join(CONTENT, name), 'utf8'));
    if (!parsed) {
      console.warn(`build: ${name} has no +++ front matter — skipped`);
      continue;
    }
    const { meta, body } = parsed;
    // draft = true is the only thing keeping an unfinished post off the site.
    // Anything that is not literally `false` is treated as a draft.
    if (meta.draft !== false) continue;
    const date = typeof meta.date === 'string' ? meta.date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      console.warn(`build: ${name} has no usable date — skipped`);
      continue;
    }
    const { html, headings } = renderMarkdown(body);
    posts.push({
      slug: name.replace(/\.md$/, ''),
      title: String(meta.title || name.replace(/\.md$/, '')),
      date,
      description: String(meta.description || ''),
      image: typeof meta.image === 'string' && meta.image ? meta.image : '',
      imageAlt: String(meta.image_alt || ''),
      tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
      topic: typeof meta.topic === 'string' ? meta.topic : '',
      html,
      headings,
      minutes: readingTime(body)
    });
  }
  // newest first; the slug breaks a same-day tie so the order is stable.
  posts.sort((a, b) => (b.date === a.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)));
  return posts;
}

const POSTS = loadPosts();
const postUrl = slug => `${SITE}/blog/${slug}/`;
const pageUrl = n => (n === 1 ? `/blog/` : `/blog/page/${n}/`);
const PAGES = Math.max(1, Math.ceil(POSTS.length / PER_PAGE));
const AVATAR_ALT = 'matthew jamison';

const RSS_LINK = `  <link rel="alternate" type="application/rss+xml" href="/feed.xml">\n`;

// ── blog: partials ───────────────────────────────────────────────────────
// Structure mirrored from ~/Code/jss-landing/layouts/_partials/author-card.html,
// re-skinned in EPK tokens. The <img> lives INSIDE the <video> as its fallback
// content, so it renders only where <video> does not — no JS decides which one
// a visitor sees. blog.js is what stops the loop under prefers-reduced-motion.
const GITHUB_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.05.78 2.12v3.15c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z"/></svg>`;
const SUBSTACK_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M22.539 8.242H1.46V5.406h21.08v2.836ZM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46ZM22.54 0H1.46v2.836h21.08V0Z"/></svg>`;

const authorCard = () => `      <aside class="author-card">
        <video class="author-card__photo" autoplay muted loop playsinline preload="metadata"
               poster="/assets/blog/avatar-240.webp" width="120" height="120" aria-hidden="true">
          <source src="/assets/blog/avatar-240.webm" type="video/webm">
          <source src="/assets/blog/avatar-240.mp4" type="video/mp4">
          <img class="author-card__photo author-card__photo--still" src="/assets/blog/avatar-120.webp"
               width="120" height="120" alt="${AVATAR_ALT}" loading="lazy" decoding="async">
        </video>
        <div class="author-card__text">
          <p class="author-card__name">matthew jamison</p>
          <p class="author-card__role">session&nbsp;bassist&nbsp;· producer&nbsp;· dev</p>
          <!-- WORKSHOP: Matthew replaces these two lines in his own words. -->
          <p class="author-card__bio">st. louis. i play bass, make beats, and write the code too.
these are the notes i keep while i figure things out.</p>
          <ul class="author-card__social" role="list">
            <li>
              <a class="author-card__social-link" href="https://github.com/MatthewJamisonJS" target="_blank" rel="me noopener">
                ${GITHUB_ICON}<span class="sr-only">matthew jamison on GitHub</span>
              </a>
            </li>
            <li>
              <a class="author-card__social-link" href="https://matthewjamisonwwjd.substack.com" target="_blank" rel="me noopener">
                ${SUBSTACK_ICON}<span class="sr-only">matthew jamison on Substack</span>
              </a>
            </li>
          </ul>
        </div>
      </aside>`;

// One subscribe form, one implementation. This exact markup ships on the home
// page too (index.html, #contact) and subscribe.js drives both.
// WORKSHOP: the label and the two status lines are Matthew's to rewrite.
const subscribeCard = id => `      <div class="subscribe-card">
          <form class="subscribe" novalidate>
            <label class="subscribe-label" for="${id}">get new music + notes by email</label>
            <div class="subscribe-row">
              <input class="subscribe-input" type="email" id="${id}" name="email"
                     autocomplete="email" required>
              <button type="submit" class="btn subscribe-btn">→ subscribe</button>
            </div>
            <!-- honeypot: hidden by class, never by style= (the CSP has no
                 'unsafe-inline'), empty for every real submit. -->
            <div class="visually-hidden" aria-hidden="true">
              <label for="${id}-website">website</label>
              <input id="${id}-website" type="text" name="website" tabindex="-1" autocomplete="off">
            </div>
            <p class="subscribe-status" role="status" aria-live="polite"></p>
          </form>
        </div>`;

const FB_ICON = `<svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M16 8.049c0-4.446-3.582-8.05-8-8.05C3.58 0-.002 3.603-.002 8.05c0 4.017 2.926 7.347 6.75 7.951v-5.625h-2.03V8.05H6.75V6.275c0-2.017 1.195-3.131 3.022-3.131.876 0 1.791.157 1.791.157v1.98h-1.009c-.993 0-1.303.621-1.303 1.258v1.51h2.218l-.354 2.326H9.25V16c3.824-.604 6.75-3.934 6.75-7.951"/></svg>`;
const LI_ICON = `<svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854zm4.943 12.248V6.169H2.542v7.225zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248S2.4 3.226 2.4 3.934c0 .694.521 1.248 1.327 1.248zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016l.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225z"/></svg>`;
const COPY_ICON = `<svg class="post-share__icon-link" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287z"/><path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z"/></svg>`;
const CHECK_ICON = `<svg class="post-share__icon-check" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425z"/></svg>`;

// Plain share intents: two anchors, no SDK, no new CSP origin, no tracker. The
// copy cube ships hidden and blog.js reveals it only where the Clipboard API
// exists, so a visitor never meets a dead control.
const postShare = url => `        <div class="post-share">
          <span class="post-share__label muted" id="post-share-label">share</span>
          <ul class="post-share__list" role="list" aria-labelledby="post-share-label">
            <li>
              <a class="post-share__btn" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">
                ${FB_ICON}<span class="sr-only">share this post on Facebook</span>
              </a>
            </li>
            <li>
              <a class="post-share__btn" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">
                ${LI_ICON}<span class="sr-only">share this post on LinkedIn</span>
              </a>
            </li>
            <li>
              <button type="button" class="post-share__btn post-share__copy" data-copy-url="${esc(url)}" data-copied-label="link copied" hidden>
                ${COPY_ICON}${CHECK_ICON}<span class="sr-only">copy a link to this post</span>
              </button>
            </li>
          </ul>
          <span class="post-share__status" role="status"></span>
        </div>`;

// ── blog: post page ──────────────────────────────────────────────────────
function postJsonLd(p) {
  const image = p.image ? SITE + p.image : `${SITE}/assets/blog/avatar-240.webp`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${postUrl(p.slug)}#article`,
    headline: p.title,
    description: p.description,
    datePublished: p.date,
    dateModified: p.date,
    author: { '@id': PERSON_ID, '@type': 'Person', name: 'Matthew Jamison' },
    image,
    mainEntityOfPage: postUrl(p.slug)
  };
}

function postPage(p) {
  const url = postUrl(p.slug);
  // The Contents panel earns its space only on a post long enough to navigate.
  // Five H2-H4 entries is the same threshold jss-landing settled on: beside a
  // two-minute read a Contents box is furniture.
  const toc =
    p.headings.length >= 5
      ? `
      <div class="article-toc">
        <details class="article-toc__box" open>
          <summary class="article-toc__summary">contents</summary>
          <nav id="TableOfContents" aria-label="contents">
            <ul>
${p.headings.map(h => `              <li><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join('\n')}
            </ul>
          </nav>
        </details>
      </div>
`
      : '';

  // One centred column, one axis. Every block below is a direct child of the
  // section and shares the same max-width, so the left and right edges of the
  // header, the author card, the Contents, the body, the share row and the
  // subscribe card all line up at every viewport. There is no side rail and no
  // second column: this page reads as one page, not a grid of cards.
  const body = `    <section class="section article-wrap" aria-label="${esc(p.title)}">
      <h2 class="section-label comment">// notes</h2>

      <header class="post-header">
        <h1 class="post-title">${esc(p.title)}</h1>
        <p class="post-meta muted">
          <time datetime="${esc(p.date)}">${esc(humanDate(p.date))}</time><span
            class="post-meta__sep" aria-hidden="true">&nbsp;·&nbsp;</span><span>${p.minutes} min read</span><span
            class="post-meta__sep" aria-hidden="true">&nbsp;·&nbsp;</span><span>by matthew jamison</span>
        </p>
      </header>

${authorCard()}
${toc}
      <article class="article prose">
${p.html}
      </article>

${postShare(url)}
${subscribeCard('subscribe-email')}
      <p class="post-back"><a href="/blog/" class="link-plain">← all notes</a></p>
    </section>
`;

  return shell({
    title: `${p.title} · matthew jamison`,
    desc: p.description,
    canonical: url,
    ogImage: p.image ? SITE + p.image : `${SITE}/assets/blog/avatar-240.webp`,
    ogImageAlt: p.imageAlt || AVATAR_ALT,
    ogType: 'article',
    headLinks: RSS_LINK,
    head: `  <script type="application/ld+json">
${JSON.stringify(postJsonLd(p), null, 2)}
  </script>
`,
    body,
    scripts: `  <script src="/blog.js?v=dev" defer></script>
  <script src="/subscribe.js?v=dev" defer></script>`
  });
}

// ── blog: listing ────────────────────────────────────────────────────────
function listingPage(n) {
  const slice = POSTS.slice((n - 1) * PER_PAGE, n * PER_PAGE);

  const cards = slice
    .map(p => {
      const size = p.image ? siteImageSize(p.image) : null;
      const thumb = p.image
        ? `
            <img class="section-list__thumb" src="${esc(p.image)}" alt="${esc(p.imageAlt || p.title)}"
                 width="${size ? size.w : 800}" height="${size ? size.h : 450}" loading="lazy" decoding="async">`
        : '';
      const topic = p.topic
        ? `<span
                    aria-hidden="true">&nbsp;·&nbsp;</span><span class="topic-label">${esc(p.topic)}</span>`
        : '';
      const desc = p.description
        ? `
              <p class="section-list__desc">${esc(p.description)}</p>`
        : '';
      return `          <li class="section-list__item">
            <a href="/blog/${esc(p.slug)}/" class="section-list__link${p.image ? ' section-list__link--thumbed' : ''}">${thumb}
              <div class="section-list__body">
                <h2 class="section-list__title">${esc(p.title)}</h2>
                <p class="section-list__meta muted">
                  <time datetime="${esc(p.date)}">${esc(humanDate(p.date))}</time><span
                    aria-hidden="true">&nbsp;·&nbsp;</span><span>${p.minutes} min read</span>${topic}
                </p>${desc}
              </div>
            </a>
          </li>`;
    })
    .join('\n');

  const pager =
    PAGES > 1
      ? `
        <nav class="pager" aria-label="notes pages">
${n > 1 ? `          <a class="pager__link pager__link--prev" href="${pageUrl(n - 1)}" rel="prev">← newer</a>\n` : ''}${n < PAGES ? `          <a class="pager__link pager__link--next" href="${pageUrl(n + 1)}" rel="next">older →</a>\n` : ''}        </nav>`
      : '';

  const list = POSTS.length
    ? `        <ul class="section-list" role="list">
${cards}
        </ul>${pager}`
    : `        <p class="blog-empty muted">nothing here yet. first note is coming.</p>`;

  const canonical = n === 1 ? `${SITE}/blog/` : `${SITE}/blog/page/${n}/`;
  const body = `    <section class="section blog-wrap" aria-label="notes">
      <h1 class="release-title release-title-hub">notes</h1>
      <!-- WORKSHOP: Matthew replaces this dek in his own words. -->
      <p class="blog-dek muted">notes on bass, gear, faith &amp; whatever else is on my mind</p>

${list}

      <div class="catalog-more">
        <a href="/" class="btn-ghost">← back home</a>
      </div>
    </section>
`;

  return shell({
    title: n === 1 ? 'notes · matthew jamison' : `notes · page ${n} · matthew jamison`,
    desc: 'notes from matthew jamison — st. louis session bassist + producer — on bass, gear, faith and the work.',
    canonical,
    ogImage: `${SITE}/assets/og-cover.jpg`,
    ogImageAlt: 'matthew jamison album cover art',
    ogType: 'website',
    headLinks: RSS_LINK,
    body,
    scripts: `  <script src="/subscribe.js?v=dev" defer></script>`
  });
}

// ── blog: feed ───────────────────────────────────────────────────────────
// RSS 2.0 with the full rendered post in the description CDATA. A reader that
// only ever sees the feed sees the whole note.
const cdata = s => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const rfc822 = iso => new Date(`${iso}T12:00:00Z`).toUTCString();

function feed() {
  const items = POSTS.slice(0, FEED_ITEMS)
    .map(
      p => `  <item>
    <title>${esc(p.title)}</title>
    <link>${postUrl(p.slug)}</link>
    <guid isPermaLink="true">${postUrl(p.slug)}</guid>
    <pubDate>${rfc822(p.date)}</pubDate>
    <description>${cdata(p.html)}</description>
  </item>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>matthew jamison · notes</title>
  <link>${SITE}/blog/</link>
  <description>notes from matthew jamison — st. louis session bassist + producer.</description>
  <language>en-us</language>
  <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

// ── blog: the // notes block on the home page ────────────────────────────
// index.html is hand-written and stays that way: the generator rewrites the
// bytes BETWEEN the two markers and nothing else, so the two sha256-pinned
// JSON blocks in that file are never touched and neither _headers hash moves.
const NOTES_START = '<!-- notes:start -->';
const NOTES_END = '<!-- notes:end -->';

function notesBlock() {
  if (!POSTS.length) return '';
  const items = POSTS.slice(0, 3)
    .map(p => `          <li><a href="/blog/${esc(p.slug)}/">${esc(p.title)}</a></li>`)
    .join('\n');
  return `
    <section id="notes" class="section" aria-label="notes">
      <h2 class="section-label comment">// notes</h2>
      <ul class="notes-list" role="list">
${items}
      </ul>
      <p class="notes-more"><a href="/blog/">→ all notes</a></p>
    </section>
`;
}

function homePage() {
  const src = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const start = src.indexOf(NOTES_START);
  const end = src.indexOf(NOTES_END);
  if (start === -1 || end === -1) {
    console.warn('build: index.html has no notes: markers — home page left alone');
    return src;
  }
  return src.slice(0, start + NOTES_START.length) + notesBlock() + src.slice(end);
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

  // /blog/ and its pager are hubs; a post's lastmod is its own date.
  const blogHub = `  <url>
    <loc>${SITE}/blog/</loc>
    <lastmod>${POSTS.length ? POSTS[0].date : TODAY}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;

  const blogPager = Array.from({ length: PAGES - 1 }, (_, i) => i + 2)
    .map(
      n => `  <url>
    <loc>${SITE}/blog/page/${n}/</loc>
    <lastmod>${POSTS.length ? POSTS[0].date : TODAY}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.4</priority>
  </url>`
    )
    .join('\n');

  const posts = POSTS.map(
    p => `  <url>
    <loc>${postUrl(p.slug)}</loc>
    <lastmod>${p.date}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.6</priority>${
      p.image
        ? `
    <image:image>
      <image:loc>${SITE}${esc(p.image)}</image:loc>
      <image:title>${esc(p.title)}</image:title>
      <image:caption>${esc(p.imageAlt || p.title)}</image:caption>
    </image:image>`
        : ''
    }
  </url>`
  ).join('\n');

  const blog = [blogHub, blogPager, posts].filter(Boolean).join('\n');

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
${blog}
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

for (const p of POSTS) write(join('blog', p.slug, 'index.html'), postPage(p));
// Page 1 is /blog/ itself; the rest live under /blog/page/N/. The listing is
// emitted even with zero posts, so the URL exists and carries the empty state
// rather than 404ing the moment the blog is announced.
write(join('blog', 'index.html'), listingPage(1));
for (let n = 2; n <= PAGES; n++) write(join('blog', 'page', String(n), 'index.html'), listingPage(n));
write('feed.xml', feed());
write('index.html', homePage());

write('sitemap.xml', sitemap());

console.log(
  `built ${releases.length} release pages + /music/ + ${POSTS.length} posts + /blog/ (${PAGES} page${PAGES === 1 ? '' : 's'}) + feed.xml + sitemap.xml into ${OUT}`
);
