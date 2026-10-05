// Optional real-media/layout check: PLAYWRIGHT_MODULE may point to an installed
// Playwright index.mjs. Uses local fixtures only; never contacts production.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '..');
const output = process.env.BROWSER_EVIDENCE_DIR || resolve(tmpdir(), 'epk-recovery-browser');
await mkdir(output, { recursive: true });
const mp3 = resolve(output, 'fixture.mp3');
execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-codec:a', 'libmp3lame', mp3], { stdio: 'ignore' });
const media = await readFile(mp3);
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local').pathname;
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [width, scenario] of [[320, 'active'], [390, 'active'], [430, 'active'], [390, 'standby'], [390, 'exhausted']]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      if (route.request().url().startsWith(url)) return route.continue();
      if (route.request().url().startsWith('https://api.matthewjamison.dev/s/')) return route.fulfill({ contentType: 'audio/flac', body: Buffer.from('invalid FLAC fixture') });
      if (route.request().url().startsWith('https://api.matthewjamison.dev/p/')) return route.fulfill({ contentType: 'audio/mpeg', body: scenario === 'exhausted' && route.request().url().endsWith('/02') ? Buffer.from('invalid network MP3 fixture') : media, headers: { 'Access-Control-Allow-Origin': '*' } });
      return route.abort();
    });
    await page.goto(url);
    await page.evaluate(async scenario => {
      localStorage.setItem('mj-stream-quality', scenario === 'standby' ? 'lossless' : 'saver');
      const request = indexedDB.open('mj-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('tracks');
      const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = reject; });
      const data = JSON.parse(document.getElementById('store-data').textContent);
      const slug = Object.keys(data).find(k => data[k].tr.length >= 3 && data[k].k === 'album');
      const nn = String(data[slug].tr[scenario === 'standby' ? 0 : 1][0]).padStart(2, '0');
      const tx = db.transaction('tracks', 'readwrite');
      tx.objectStore('tracks').put({ blob: new Blob(['invalid media fixture'], { type: 'audio/mpeg' }), bytes: 21, at: Date.now() }, slug + '/' + nn);
      await new Promise(resolve => tx.oncomplete = resolve);
      db.close();
      sessionStorage.setItem('test-slug', slug);
    }, scenario);
    await page.reload();
    await page.locator('.audio-diag summary').click();
    await page.locator('#audio-diag-toggle').click();
    const slug = await page.evaluate(() => sessionStorage.getItem('test-slug'));
    await page.locator('.store-play[data-slug="' + slug + '"]').first().click();
    if (scenario !== 'standby') {
    await page.waitForFunction(() => Array.from(document.querySelectorAll('audio')).some(a => a.currentTime > .2));
    // Wait for the prefetch read of the intentionally invalid saved second track.
    await page.waitForTimeout(300);
    await page.locator('#store-next').click();
    }
    if (scenario === 'exhausted') await page.waitForFunction(() => document.getElementById('store-status').textContent.includes('didn’t load'));
    else await page.waitForFunction(() => Array.from(document.querySelectorAll('audio')).some(a => a.src.includes('/p/') && a.currentTime > .3));
    await page.locator('#audio-diag-export').click();
    assert.ok((await page.locator('#audio-diag-output').inputValue()).length < 600);
    const downloading = page.waitForEvent('download');
    await page.locator('#audio-diag-download').click();
    const download = await downloading;
    const file = resolve(output, 'trace-' + scenario + '-' + width + '.json');
    await download.saveAs(file);
    const trace = JSON.parse(await readFile(file, 'utf8'));
    assert.ok(trace.events.some(e => e.slots.some(s => s.source === 'saved' && s.error === 4)), 'real invalid blob produced MEDIA_ERR_SRC_NOT_SUPPORTED');
    if (scenario === 'exhausted') {
      assert.ok(trace.events.some(e => e.event === 'handoff-failed'));
      assert.equal(await page.locator('#store-toggle').getAttribute('aria-label'), 'resume playback');
      assert.equal(await page.evaluate(() => navigator.mediaSession.playbackState), 'paused');
    } else {
      assert.ok(trace.events.some(e => e.event === 'handoff-complete' && e.slots[e.active].source === 'mp3'));
      assert.equal(await page.locator('#store-toggle').getAttribute('aria-label'), 'pause playback');
    }
    assert.ok(!JSON.stringify(trace).includes('https://'));
    const layout = await page.locator('.audio-diag').evaluate(el => ({ width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right, controls: [...el.querySelectorAll('button')].map(b => ({ height: b.getBoundingClientRect().height, right: b.getBoundingClientRect().right })), summary: el.querySelector('textarea').getBoundingClientRect().right }));
    assert.ok(layout.right <= width + 1 && layout.summary <= width + 1);
    assert.ok(layout.controls.every(b => b.height >= 44 && b.right <= width + 1));
    await page.locator('#store-stop').click();
    await page.locator('#audio-diag-output').scrollIntoViewIfNeeded();
    await page.locator('.audio-diag').screenshot({ path: resolve(output, 'mobile-' + scenario + '-' + width + '.png') });
    assert.deepEqual(errors, []);
    results.push({ width, scenario, realMediaChecked: true, sanitizedDownload: true, controlsFit: true, pageErrors: errors.length });
    await context.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
