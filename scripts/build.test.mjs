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
