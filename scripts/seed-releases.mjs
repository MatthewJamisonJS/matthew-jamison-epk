#!/usr/bin/env node
// One-off: build data/releases.json from the #store-data block in index.html.
//
// Kept in the repo as the record of where the seed came from, not as part of
// the deploy. After the first run data/releases.json is the source of truth —
// re-running this overwrites hand-added fields (released / blurb / credits),
// so it refuses to clobber an existing file unless --force is passed.
//
//   node scripts/seed-releases.mjs [--force]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'data', 'releases.json');

if (existsSync(out) && !process.argv.includes('--force')) {
  console.error(`refusing to overwrite ${out} — pass --force if you mean it`);
  process.exit(1);
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
const m = html.match(/<script type="application\/json" id="store-data">(.*?)<\/script>/s);
if (!m) throw new Error('no #store-data block in index.html');
const store = JSON.parse(m[1]);

// #store-data also carries the two sample packs and the bundle. Those are not
// MusicAlbums and they live in #samples, not #catalog — they get no release
// page, so they are not seeded.
const MUSIC_KINDS = new Set(['single', 'ep', 'album']);

const releases = Object.entries(store)
  .filter(([, r]) => MUSIC_KINDS.has(r.k))
  .map(([slug, r]) => ({
    slug,
    title: r.t,
    kind: r.k,
    price: Number(String(r.p).replace(/[^0-9.]/g, '')),
    tracks: r.tr.map(([n, title, seconds]) => ({ n, title, seconds })),
    // no release-date column exists anywhere in worker/ — Matthew supplies these
    released: null,
    blurb: null,
    credits: []
  }));

writeFileSync(out, JSON.stringify(releases, null, 2) + '\n');
console.log(`wrote ${releases.length} releases to ${out}`);
