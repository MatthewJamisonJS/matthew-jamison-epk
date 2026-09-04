#!/usr/bin/env node
// Outer acceptance loop for the content layer generator (Phase 1).
//
//   node scripts/build.test.mjs
//
// node:test only — the site has no npm dependencies and this must stay
// runnable on a bare `node` in CI. The generator is run against a throwaway
// output directory so the repo's own music/ and sitemap.xml are untouched.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const releases = JSON.parse(readFileSync(join(root, 'data', 'releases.json'), 'utf8'));

const out = mkdtempSync(join(tmpdir(), 'mj-build-'));
process.on('exit', () => rmSync(out, { recursive: true, force: true }));

execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs'), '--out', out], {
  stdio: 'pipe'
});

const read = (...p) => readFileSync(join(out, ...p), 'utf8');
const journey = releases.find(r => r.slug === 'the-journey');

// Scenario 1 — Given data/releases.json has the-journey, when the site builds,
// then /music/the-journey/ exists with one <h1>, its full tracklist, a
// self-canonical, and a MusicAlbum JSON-LD.
test('release page: one <h1>', () => {
  const html = read('music', 'the-journey', 'index.html');
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(html, />the journey</);
});

test('release page: tracklist has every track', () => {
  const html = read('music', 'the-journey', 'index.html');
  const ol = html.match(/<ol class="release-tracks">([\s\S]*?)<\/ol>/);
  assert.ok(ol, 'no <ol class="release-tracks">');
  assert.equal((ol[1].match(/<li/g) || []).length, journey.tracks.length);
  assert.equal(journey.tracks.length, 13);
});

test('release page: canonical points at itself', () => {
  for (const r of releases) {
    const html = read('music', r.slug, 'index.html');
    assert.match(
      html,
      new RegExp(`<link rel="canonical" href="https://matthewjamison\\.dev/music/${r.slug}/">`),
      `${r.slug} canonical`
    );
  }
});

test('release page: JSON-LD parses and is a MusicAlbum', () => {
  for (const r of releases) {
    const html = read('music', r.slug, 'index.html');
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(m, `${r.slug}: no JSON-LD block`);
    const ld = JSON.parse(m[1]);
    assert.equal(ld['@type'], 'MusicAlbum', `${r.slug}: @type`);
    assert.equal(ld.byArtist['@id'], 'https://matthewjamison.dev/#matthew-jamison');
    assert.equal(ld.numTracks, r.tracks.length, `${r.slug}: numTracks`);
    assert.equal(ld.track.numberOfItems, r.tracks.length, `${r.slug}: track ItemList`);
    assert.equal(ld.offers.price, r.price.toFixed(2), `${r.slug}: offer price`);
    assert.equal(ld.offers.priceCurrency, 'USD');
    assert.equal(ld.offers.url, `https://matthewjamison.dev/music/${r.slug}/`);
    assert.match(ld.image, /-700\.webp$/);
    for (const item of ld.track.itemListElement) {
      assert.equal(item['@type'], 'MusicRecording');
      assert.match(item.duration, /^PT(\d+M)?(\d+S)?$/, `${r.slug}: ISO duration`);
    }
    if (r.released) assert.equal(ld.datePublished, r.released);
    else assert.ok(!('datePublished' in ld), `${r.slug}: no date, no datePublished`);
  }
});

// Scenario 2 (partial) — the buy control carries the slug the Worker expects
// and the page loads the module that POSTs it. The redirect itself is a
// browser check, not a unit one.
test('release page: buy button carries its slug and loads release.js', () => {
  const html = read('music', 'the-journey', 'index.html');
  assert.match(html, /class="btn release-buy" data-slug="the-journey"/);
  assert.match(html, /<script src="\/release\.js\?v=dev" defer><\/script>/);
});

// Scenario 3 — the sitemap lists /, /music/, and every release with a lastmod.
test('sitemap lists /, /music/ and every release with a lastmod', () => {
  const xml = read('sitemap.xml');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(locs.includes('https://matthewjamison.dev/'), 'missing /');
  assert.ok(locs.includes('https://matthewjamison.dev/music/'), 'missing /music/');
  for (const r of releases) {
    assert.ok(
      locs.includes(`https://matthewjamison.dev/music/${r.slug}/`),
      `sitemap missing ${r.slug}`
    );
  }
  const urls = [...xml.matchAll(/<url>[\s\S]*?<\/url>/g)].map(m => m[0]);
  for (const u of urls) assert.match(u, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  // the three bass-sample image entries on / survive regeneration
  assert.match(xml, /infinity-loops-700\.webp/);
  assert.match(xml, /bass-latin-vol-1-700\.webp/);
  assert.match(xml, /bass-samples-bundle-700\.webp/);
  // /thanks/ stays out on purpose (the explanatory comment may name it; no <loc> may)
  assert.ok(!locs.some(l => l.includes('/thanks/')), '/thanks/ must not be in the sitemap');
  // every release carries its 700px cover as an image entry
  for (const r of releases) {
    assert.ok(xml.includes(`/assets/covers/${r.slug}-700.webp`), `no image entry for ${r.slug}`);
  }
});

// Shell invariants — the CSP has no 'unsafe-inline' and requires Trusted Types.
test('generated pages carry no inline style or executable inline script', () => {
  const pages = [join('music', 'index.html'), ...releases.map(r => join('music', r.slug, 'index.html'))];
  for (const p of pages) {
    const html = read(p);
    assert.ok(!/<style[\s>]/.test(html), `${p}: inline <style>`);
    assert.ok(!/\sstyle="/.test(html), `${p}: style= attribute`);
    // the only inline <script> allowed is the non-executable ld+json data block
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)].map(m => m[0]);
    for (const tag of inline) {
      assert.match(tag, /type="application\/ld\+json"/, `${p}: executable inline script`);
    }
  }
});

test('hub page links every release', () => {
  const html = read('music', 'index.html');
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/matthewjamison\.dev\/music\/">/);
  for (const r of releases) {
    assert.ok(html.includes(`href="/music/${r.slug}/"`), `hub missing ${r.slug}`);
  }
});

test('release.js exists and is referenced with a cache-busting query', () => {
  assert.ok(existsSync(join(root, 'release.js')), 'release.js missing');
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 2 — blog.
//
// The generator is run a second and third time against throwaway content and
// output dirs (`--content <dir> --out <dir>`), so the repo's own content/ can
// stay empty and these fixtures never reach a deploy.

import { mkdirSync, writeFileSync, cpSync } from 'node:fs';

const fixtures = mkdtempSync(join(tmpdir(), 'mj-content-'));
const blogOut = mkdtempSync(join(tmpdir(), 'mj-blog-'));
const emptyContent = mkdtempSync(join(tmpdir(), 'mj-empty-content-'));
const emptyOut = mkdtempSync(join(tmpdir(), 'mj-empty-'));
process.on('exit', () => {
  for (const d of [fixtures, blogOut, emptyContent, emptyOut]) {
    rmSync(d, { recursive: true, force: true });
  }
});

const post = (slug, fm, body) => writeFileSync(join(fixtures, `${slug}.md`), `+++\n${fm}\n+++\n\n${body}\n`);

// the short note: three lines, no cover, no headings -> no Contents panel
post(
  'short-note',
  `title = "the take that stuck"
date = 2026-09-01
draft = false
description = "one take, one room, nothing fixed after."
tags = ["sp-404"]
topic = "music"
publish_at = 2026-09-01`,
  `i tracked it once and left it alone.

the room was doing half the work anyway.

that is the whole note.`
);

// the long post: 6 headings (so the Contents panel renders), a cover, lists, a
// quote, a code fence, a link, an image, and a raw-HTML injection attempt that
// must come out escaped.
post(
  'long-post',
  `title = "how i set the room up"
date = 2026-09-03
draft = false
description = "the signal chain, the mistakes, and what i would keep."
image = "/assets/blog/long-post-cover.webp"
image_alt = "a bass leaning on an amp"
tags = ["gear", "process"]
topic = "gear"
publish_at = 2026-09-03`,
  `a short intro paragraph with **strong**, *em*, a \`code span\` and a [link](https://example.com/).

## the room

first heading body.

![a bass leaning on an amp](/assets/blog/long-post-cover.webp)

## the chain

- di box
- one preamp
- nothing else

## the takes

1. warm up
2. hit record
3. stop touching it

## the mistakes

> i mixed it too early. every time.

## what i kept

\`\`\`
gain: 11 o'clock
tone: flat
\`\`\`

## what i would change

<script>alert(1)</script>

---

done.`
);

// a scheduled draft: must never appear anywhere in the output
post(
  'not-yet',
  `title = "not yet"
date = 2026-09-10
draft = true
description = "should not ship."
publish_at = 2099-01-01`,
  `nothing to see.`
);

// enough published posts to force a second pager page (10 per page)
for (let i = 1; i <= 9; i++) {
  post(
    `filler-${i}`,
    `title = "filler ${i}"
date = 2026-08-${String(i).padStart(2, '0')}
draft = false
description = "filler post ${i}."
topic = "notes"
publish_at = 2026-08-${String(i).padStart(2, '0')}`,
    `body ${i}.`
  );
}

// a cover for the long post, so the card thumb path is exercised
mkdirSync(join(blogOut, 'assets', 'blog'), { recursive: true });
cpSync(join(root, 'assets', 'blog', 'avatar-240.webp'), join(blogOut, 'assets', 'blog', 'long-post-cover.webp'));

execFileSync(
  process.execPath,
  [join(root, 'scripts', 'build.mjs'), '--out', blogOut, '--content', fixtures],
  { stdio: 'pipe' }
);
execFileSync(
  process.execPath,
  [join(root, 'scripts', 'build.mjs'), '--out', emptyOut, '--content', emptyContent],
  { stdio: 'pipe' }
);

const readBlog = (...p) => readFileSync(join(blogOut, ...p), 'utf8');
const readEmpty = (...p) => readFileSync(join(emptyOut, ...p), 'utf8');

test('blog: only draft = false posts are rendered', () => {
  assert.ok(existsSync(join(blogOut, 'blog', 'short-note', 'index.html')), 'short-note missing');
  assert.ok(existsSync(join(blogOut, 'blog', 'long-post', 'index.html')), 'long-post missing');
  assert.ok(!existsSync(join(blogOut, 'blog', 'not-yet')), 'a draft was published');
  const index = readBlog('blog', 'index.html');
  assert.ok(!index.includes('not yet'), 'draft leaked into the listing');
  assert.ok(!readBlog('feed.xml').includes('not-yet'), 'draft leaked into the feed');
  assert.ok(!readBlog('sitemap.xml').includes('/blog/not-yet/'), 'draft leaked into the sitemap');
});

test('post page: header, one <h1>, byline meta and canonical', () => {
  const html = readBlog('blog', 'short-note', 'index.html');
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(html, />the take that stuck</);
  assert.match(html, /<link rel="canonical" href="https:\/\/matthewjamison\.dev\/blog\/short-note\/">/);
  assert.match(html, /<time datetime="2026-09-01">/);
  assert.match(html, /1 min read/);
  assert.match(html, /by matthew jamison/);
  assert.match(html, /<meta name="description" content="one take, one room, nothing fixed after\.">/);
  assert.match(html, /<link rel="alternate" type="application\/rss\+xml" href="\/feed\.xml">/);
});

test('post page: Article JSON-LD names the Person @id', () => {
  const html = readBlog('blog', 'long-post', 'index.html');
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'no JSON-LD');
  const ld = JSON.parse(m[1]);
  assert.equal(ld['@type'], 'Article');
  assert.equal(ld.headline, 'how i set the room up');
  assert.equal(ld.datePublished, '2026-09-03');
  assert.equal(ld.dateModified, '2026-09-03');
  assert.equal(ld.author['@id'], 'https://matthewjamison.dev/#matthew-jamison');
  assert.equal(ld.author['@type'], 'Person');
  assert.equal(ld.author.name, 'Matthew Jamison');
  assert.equal(ld.mainEntityOfPage, 'https://matthewjamison.dev/blog/long-post/');
  assert.match(ld.image, /long-post-cover\.webp$/);
});

test('post page: Contents renders only at 5+ headings', () => {
  const long = readBlog('blog', 'long-post', 'index.html');
  const short = readBlog('blog', 'short-note', 'index.html');
  assert.match(long, /<details class="article-toc__box" open>/);
  // one entry per H2 in the fixture
  const toc = long.match(/<nav id="TableOfContents"[\s\S]*?<\/nav>/);
  assert.ok(toc, 'no TOC nav');
  assert.equal((toc[0].match(/<li>/g) || []).length, 6);
  assert.ok(!short.includes('article-toc__box'), 'short note got a Contents panel');
});

test('post page: markdown subset renders, raw HTML never passes through', () => {
  const html = readBlog('blog', 'long-post', 'index.html');
  const article = html.match(/<article class="article prose">([\s\S]*?)<\/article>/)[1];
  assert.match(article, /<h2 id="the-room">the room<\/h2>/);
  assert.match(article, /<strong>strong<\/strong>/);
  assert.match(article, /<em>em<\/em>/);
  assert.match(article, /<code>code span<\/code>/);
  assert.match(article, /<a href="https:\/\/example\.com\/" rel="noopener noreferrer">link<\/a>/);
  assert.match(article, /<img class="prose-figure" src="\/assets\/blog\/long-post-cover\.webp" alt="a bass leaning on an amp"/);
  assert.match(article, /<ul>\s*<li>di box<\/li>/);
  assert.match(article, /<ol>\s*<li>warm up<\/li>/);
  assert.match(article, /<blockquote>/);
  assert.match(article, /<pre><code>gain: 11 o&#x27;clock/);
  assert.match(article, /<hr>/);
  // the injection attempt is text, not markup
  assert.ok(!/<script>alert\(1\)<\/script>/.test(article), 'raw HTML passed through');
  assert.match(article, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('post page: end strip carries share cubes, subscribe form and the back link', () => {
  const html = readBlog('blog', 'short-note', 'index.html');
  assert.match(html, /facebook\.com\/sharer\/sharer\.php\?u=https%3A%2F%2Fmatthewjamison\.dev%2Fblog%2Fshort-note%2F/);
  assert.match(html, /linkedin\.com\/sharing\/share-offsite\/\?url=https%3A%2F%2Fmatthewjamison\.dev%2Fblog%2Fshort-note%2F/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /class="post-share__btn post-share__copy"[^>]*hidden/);
  assert.match(html, /<form class="subscribe" novalidate>/);
  // the honeypot: present, named website, hidden by class (style= is CSP-forbidden)
  assert.match(html, /<div class="visually-hidden" aria-hidden="true">/);
  assert.match(html, /name="website"[^>]*tabindex="-1"/);
  assert.ok(!/name="website"[^>]*style="/.test(html), 'honeypot hidden with an inline style');
  assert.match(html, /href="\/blog\/" class="link-plain">← all notes<\/a>/);
  assert.match(html, /<script src="\/blog\.js\?v=dev" defer><\/script>/);
  assert.match(html, /<script src="\/subscribe\.js\?v=dev" defer><\/script>/);
});

test('post page: author card holds both video sources and an img fallback', () => {
  const html = readBlog('blog', 'short-note', 'index.html');
  assert.match(html, /<video class="author-card__photo"[^>]*poster="\/assets\/blog\/avatar-240\.webp"/);
  assert.match(html, /<source src="\/assets\/blog\/avatar-240\.webm" type="video\/webm">/);
  assert.match(html, /<source src="\/assets\/blog\/avatar-240\.mp4" type="video\/mp4">/);
  assert.match(html, /<img class="author-card__photo author-card__photo--still"/);
  assert.match(html, /rel="me noopener"/);
  assert.match(html, /github\.com\/MatthewJamisonJS/);
  assert.match(html, /matthewjamisonwwjd\.substack\.com/);
  assert.match(html, /<span class="sr-only">matthew jamison on GitHub<\/span>/);
});

test('blog index: newest first, cover thumb, meta line, pager at 10 per page', () => {
  const p1 = readBlog('blog', 'index.html');
  assert.equal((p1.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(p1, /<link rel="canonical" href="https:\/\/matthewjamison\.dev\/blog\/">/);
  const titles = [...p1.matchAll(/<h2 class="section-list__title">([^<]+)<\/h2>/g)].map(m => m[1]);
  assert.equal(titles.length, 10, 'page 1 holds 10 cards');
  assert.equal(titles[0], 'how i set the room up', 'newest first');
  assert.equal(titles[1], 'the take that stuck');
  assert.match(p1, /<img class="section-list__thumb" src="\/assets\/blog\/long-post-cover\.webp"/);
  assert.match(p1, /alt="a bass leaning on an amp"/);
  assert.match(p1, /1 min read/);
  assert.match(p1, /class="topic-label">gear</);
  assert.match(p1, /<a class="pager__link pager__link--next" href="\/blog\/page\/2\/" rel="next">/);

  const p2 = readBlog('blog', 'page', '2', 'index.html');
  assert.equal((p2.match(/<h2 class="section-list__title">/g) || []).length, 1);
  assert.match(p2, /<a class="pager__link pager__link--prev" href="\/blog\/" rel="prev">/);
  assert.match(p2, /<link rel="canonical" href="https:\/\/matthewjamison\.dev\/blog\/page\/2\/">/);
});

test('feed.xml: RSS 2.0, newest first, full HTML in CDATA, self link', () => {
  const xml = readBlog('feed.xml');
  assert.match(xml, /<rss version="2\.0"/);
  assert.match(xml, /<atom:link href="https:\/\/matthewjamison\.dev\/feed\.xml" rel="self" type="application\/rss\+xml"\s*\/>/);
  assert.match(xml, /<lastBuildDate>/);
  const items = [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].map(m => m[0]);
  assert.equal(items.length, 11, 'every published post, capped at 20');
  assert.match(items[0], /<link>https:\/\/matthewjamison\.dev\/blog\/long-post\/<\/link>/);
  assert.match(items[0], /<!\[CDATA\[/);
  assert.match(items[0], /<h2 id="the-room">/);
  assert.match(items[0], /<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4}/);
});

test('sitemap: /blog/, the pager pages and every published post', () => {
  const xml = readBlog('sitemap.xml');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(locs.includes('https://matthewjamison.dev/blog/'), 'missing /blog/');
  assert.ok(locs.includes('https://matthewjamison.dev/blog/page/2/'), 'missing pager page 2');
  assert.ok(locs.includes('https://matthewjamison.dev/blog/long-post/'), 'missing long-post');
  assert.ok(locs.includes('https://matthewjamison.dev/blog/short-note/'), 'missing short-note');
  const postUrl = xml.match(/<url>\s*<loc>https:\/\/matthewjamison\.dev\/blog\/long-post\/<\/loc>[\s\S]*?<\/url>/)[0];
  assert.match(postUrl, /<lastmod>2026-09-03<\/lastmod>/);
});

test('home page: the // notes block lists the latest three and links to /blog/', () => {
  const html = readBlog('index.html');
  const block = html.match(/<!-- notes:start -->([\s\S]*?)<!-- notes:end -->/);
  assert.ok(block, 'notes markers missing from the rendered index.html');
  assert.match(block[1], /<section id="notes"/);
  const links = [...block[1].matchAll(/href="\/blog\/([a-z0-9-]+)\/"/g)].map(m => m[1]);
  assert.deepEqual(links, ['long-post', 'short-note', 'filler-9']);
  assert.match(block[1], /→ all notes/);
  // the two hash-pinned data blocks must survive the rewrite byte for byte
  const src = readFileSync(join(root, 'index.html'), 'utf8');
  for (const re of [
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    /<script type="application\/json" id="store-data">[\s\S]*?<\/script>/
  ]) {
    assert.equal(html.match(re)[0], src.match(re)[0], 'a hash-pinned block moved');
  }
});

test('no posts: /blog/ still exists with an empty state, feed carries zero items', () => {
  assert.ok(existsSync(join(emptyOut, 'blog', 'index.html')), '/blog/ must exist with no posts');
  const index = readEmpty('blog', 'index.html');
  assert.match(index, /class="blog-empty/);
  assert.ok(!index.includes('pager__link'), 'pager on an empty listing');
  const xml = readEmpty('feed.xml');
  assert.match(xml, /<rss version="2\.0"/);
  assert.equal((xml.match(/<item>/g) || []).length, 0);
  // and the home page drops the notes section entirely
  const home = readEmpty('index.html');
  assert.ok(!home.includes('<section id="notes"'), 'notes section rendered with no posts');
  assert.match(home, /<!-- notes:start -->\s*<!-- notes:end -->/);
});

test('blog pages carry no inline style or executable inline script', () => {
  const pages = [
    join('blog', 'index.html'),
    join('blog', 'page', '2', 'index.html'),
    join('blog', 'short-note', 'index.html'),
    join('blog', 'long-post', 'index.html')
  ];
  for (const p of pages) {
    const html = readBlog(p);
    assert.ok(!/<style[\s>]/.test(html), `${p}: inline <style>`);
    assert.ok(!/\sstyle="/.test(html), `${p}: style= attribute`);
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)].map(m => m[0]);
    for (const tag of inline) {
      assert.match(tag, /type="application\/ld\+json"/, `${p}: executable inline script`);
    }
  }
});

test('blog.js and subscribe.js exist', () => {
  assert.ok(existsSync(join(root, 'blog.js')), 'blog.js missing');
  assert.ok(existsSync(join(root, 'subscribe.js')), 'subscribe.js missing');
});
