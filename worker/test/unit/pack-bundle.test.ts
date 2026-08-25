import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDownloadToken, getToken } from '../../src/lib/db';
import { handleFile, handleLanding } from '../../src/routes/download';
import { isoNow } from '../../src/lib/tokens';

/**
 * Sample packs and bundles reuse the two R2 key slots that music uses for two
 * encodings. A pack puts the same zip in both; a bundle puts two different
 * packs in them. So the things worth pinning down are: what the landing page
 * offers, which object each slot actually resolves to, and that the shared
 * download counter is unaffected by any of it.
 */

const INFINITY_KEY = 'albums/infinity-loops/infinity-loops-wav.zip';
const LATIN_KEY = 'albums/bass-latin-vol-1/bass-latin-vol-1-wav.zip';
const ALBUM_WAV_KEY = 'albums/example-album/example-album-wav.zip';
const ALBUM_MP3_KEY = 'albums/example-album/example-album-mp3-320.zip';

async function seedAlbum(
  slug: string,
  title: string,
  kind: string,
  priceCents: number,
  wavKey: string,
  mp3Key: string,
) {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO albums
       (slug, title, kind, price_cents, stripe_price_id, r2_key_wav, r2_key_mp3, active)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)`,
  )
    .bind(slug, title, kind, priceCents, `price_${slug}`, wavKey, mp3Key)
    .run();
}

async function seedPurchase(id: string, slug: string) {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO purchases
       (id, payment_intent_id, email, album_slug, amount_total_cents, tax_cents,
        currency, country, status, created_at)
     VALUES (?1, 'pi_packs', 'fan@example.com', ?2, 2000, 0, 'usd', 'US', 'paid', ?3)`,
  )
    .bind(id, slug, isoNow())
    .run();
}

async function mintToken(purchaseId: string, slug: string): Promise<string> {
  await seedPurchase(purchaseId, slug);
  return createDownloadToken(env, purchaseId, slug);
}

function req(path: string): Request {
  return new Request(`https://api.matthewjamison.dev${path}`, {
    headers: { 'CF-Connecting-IP': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  });
}

async function landingHtml(token: string): Promise<string> {
  const ctx = createExecutionContext();
  const res = await handleLanding(req(`/d/${token}`), env, ctx, { token });
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
  return res.text();
}

async function fileRes(token: string, format: string): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await handleFile(req(`/d/${token}/file?format=${format}`), env, ctx, { token });
  await waitOnExecutionContext(ctx);
  return res;
}

/** Every href the landing page offers, in page order. */
function buttonFormats(html: string): string[] {
  return [...html.matchAll(/href="[^"]*\/file\?format=([a-z0-9]+)"/g)].map((m) => m[1]!);
}

function buttonLabels(html: string): string[] {
  return [...html.matchAll(/<a class="btn[^"]*" href="[^"]*"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]!);
}

beforeAll(async () => {
  await seedAlbum('infinity-loops', 'INFINITY LOOPS', 'pack', 2000, INFINITY_KEY, INFINITY_KEY);
  await seedAlbum(
    'bass-latin-vol-1',
    'BASS SAMPLE PACK VOL. 1 [LATIN EDITION]',
    'pack',
    2000,
    LATIN_KEY,
    LATIN_KEY,
  );
  await seedAlbum(
    'bass-samples-bundle',
    'BASS SAMPLE PACKS BUNDLE',
    'bundle',
    3500,
    INFINITY_KEY,
    LATIN_KEY,
  );
  await seedAlbum('example-album', 'Example Album', 'album', 999, ALBUM_WAV_KEY, ALBUM_MP3_KEY);

  // Distinct bodies, so "which object was served" is answerable from the bytes.
  await env.ALBUMS.put(INFINITY_KEY, 'INFINITY-ZIP');
  await env.ALBUMS.put(LATIN_KEY, 'LATIN-ZIP');
  await env.ALBUMS.put(ALBUM_WAV_KEY, 'ALBUM-WAV-ZIP');
  await env.ALBUMS.put(ALBUM_MP3_KEY, 'ALBUM-MP3-ZIP');
});

describe('the kind CHECK after migration 0002', () => {
  it('accepts pack and bundle', async () => {
    await expect(seedAlbum('check-pack', 'P', 'pack', 2000, 'k/a.zip', 'k/a.zip')).resolves.toBeUndefined();
    await expect(seedAlbum('check-bundle', 'B', 'bundle', 3500, 'k/a.zip', 'k/b.zip')).resolves.toBeUndefined();
  });

  it('still rejects a kind that is not in the list', async () => {
    await expect(seedAlbum('check-junk', 'J', 'junk', 100, 'k/a.zip', 'k/a.zip')).rejects.toThrow();
  });

  it('kept the existing kinds and the rows in them', async () => {
    const row = await env.DB.prepare(`SELECT kind, title FROM albums WHERE slug = 'example-album'`)
      .first<{ kind: string; title: string }>();
    expect(row).toEqual({ kind: 'album', title: 'Example Album' });
  });
});

describe('landing page buttons', () => {
  it('offers one button for a pack, because both key slots are the same zip', async () => {
    const token = await mintToken('cs_pack_landing', 'infinity-loops');
    const html = await landingHtml(token);
    expect(buttonFormats(html)).toEqual(['wav']);
    expect(buttonLabels(html)).toEqual(['download pack (wav)']);
    // Nothing on the page may claim a second format exists.
    expect(html).not.toContain('both formats');
    expect(html).not.toContain('MP3');
  });

  it('offers two buttons for a bundle, named after the two packs', async () => {
    const token = await mintToken('cs_bundle_landing', 'bass-samples-bundle');
    const html = await landingHtml(token);
    expect(buttonFormats(html)).toEqual(['wav', 'mp3']);
    expect(buttonLabels(html)).toEqual([
      'INFINITY LOOPS',
      'BASS SAMPLE PACK VOL. 1 [LATIN EDITION]',
    ]);
    expect(html).toContain('shared across both packs');
    expect(html).not.toContain('both formats');
  });

  it('names a bundle part positionally when its album row is gone', async () => {
    // The bundle points at a slug that has no albums row -- a pack deleted or
    // not yet seeded. The page must still offer both halves rather than 500 or
    // silently label the missing one with the other pack's name.
    await seedAlbum(
      'orphan-bundle',
      'ORPHAN BUNDLE',
      'bundle',
      3500,
      'albums/no-such-pack/no-such-pack-wav.zip',
      LATIN_KEY,
    );
    const token = await mintToken('cs_orphan_landing', 'orphan-bundle');
    const html = await landingHtml(token);
    expect(buttonFormats(html)).toEqual(['wav', 'mp3']);
    expect(buttonLabels(html)).toEqual([
      'download the first pack',
      'BASS SAMPLE PACK VOL. 1 [LATIN EDITION]',
    ]);
  });

  it('still offers WAV and MP3 320 for an album', async () => {
    const token = await mintToken('cs_album_landing', 'example-album');
    const html = await landingHtml(token);
    expect(buttonFormats(html)).toEqual(['wav', 'mp3']);
    expect(buttonLabels(html)).toEqual(['download WAV', 'download MP3 320']);
    expect(html).toContain('shared across both formats');
  });
});

describe('which object each slot serves', () => {
  it('sends a bundle buyer two different zips', async () => {
    const token = await mintToken('cs_bundle_files', 'bass-samples-bundle');

    const wav = await fileRes(token, 'wav');
    expect(wav.status).toBe(200);
    expect(await wav.text()).toBe('INFINITY-ZIP');
    expect(wav.headers.get('Content-Disposition')).toContain('INFINITY LOOPS (WAV).zip');

    const mp3 = await fileRes(token, 'mp3');
    expect(mp3.status).toBe(200);
    expect(await mp3.text()).toBe('LATIN-ZIP');
    // The mp3 SLOT holds a pack, so the name is that pack -- never "MP3 320".
    expect(mp3.headers.get('Content-Disposition')).toContain(
      'BASS SAMPLE PACK VOL. 1 [LATIN EDITION] (WAV).zip',
    );
    expect(mp3.headers.get('Content-Disposition')).not.toContain('MP3 320');
  });

  it('sends a pack buyer the same zip whichever slot is asked for', async () => {
    const token = await mintToken('cs_pack_files', 'infinity-loops');

    const wav = await fileRes(token, 'wav');
    expect(await wav.text()).toBe('INFINITY-ZIP');

    // Only the wav button is ever rendered, but a hand-typed ?format=mp3 must
    // serve, not 500 -- and it is the same file, so it is the same name.
    const mp3 = await fileRes(token, 'mp3');
    expect(mp3.status).toBe(200);
    expect(await mp3.text()).toBe('INFINITY-ZIP');
    expect(mp3.headers.get('Content-Disposition')).toContain('INFINITY LOOPS (WAV).zip');
  });

  it('leaves album format naming alone', async () => {
    const token = await mintToken('cs_album_files', 'example-album');
    const mp3 = await fileRes(token, 'mp3');
    expect(await mp3.text()).toBe('ALBUM-MP3-ZIP');
    expect(mp3.headers.get('Content-Disposition')).toContain('Example Album (MP3 320).zip');
  });
});

describe('the shared download counter across a bundle', () => {
  it('spends one per file and refuses the sixth, whichever pack it is', async () => {
    const token = await mintToken('cs_bundle_count', 'bass-samples-bundle');

    // Five, alternating between the two packs.
    for (const format of ['wav', 'mp3', 'wav', 'mp3', 'wav']) {
      expect((await fileRes(token, format)).status).toBe(200);
    }
    expect((await getToken(env, token))!.download_count).toBe(5);

    // The sixth is refused on either pack.
    expect((await fileRes(token, 'mp3')).status).toBe(403);
    expect((await fileRes(token, 'wav')).status).toBe(403);
    expect((await getToken(env, token))!.download_count).toBe(5);
  });

  it('a hand-typed second format on a pack still costs a download', async () => {
    const token = await mintToken('cs_pack_count', 'bass-latin-vol-1');
    await fileRes(token, 'wav');
    await fileRes(token, 'mp3');
    expect((await getToken(env, token))!.download_count).toBe(2);
  });
});

describe('a missing R2 object on one half of a bundle', () => {
  it('refunds the download rather than spending it', async () => {
    await seedAlbum(
      'gappy-bundle',
      'GAPPY BUNDLE',
      'bundle',
      3500,
      INFINITY_KEY,
      'albums/not-uploaded-yet/not-uploaded-yet-wav.zip',
    );
    const token = await mintToken('cs_gappy', 'gappy-bundle');

    const res = await fileRes(token, 'mp3');
    expect(res.status).toBe(500);
    expect((await getToken(env, token))!.download_count).toBe(0);

    // The half that IS uploaded still works.
    expect((await fileRes(token, 'wav')).status).toBe(200);
    expect((await getToken(env, token))!.download_count).toBe(1);
  });
});
