import type { AlbumRow, Ctx, Env, Format, TokenRow } from '../types';
import {
  consumeDownload,
  createDownloadToken,
  formatLabel,
  getAlbum,
  getToken,
  intVar,
  logDownloadEvent,
  r2KeyFor,
  refundDownload,
  slugFromR2Key,
} from '../lib/db';
import { clientIp, escapeHtml, generic404, html, ipCountry, page } from '../lib/http';
import { alert, drainOutbox, enqueue } from '../lib/outbox';
import { contentDisposition, looksLikeToken } from '../lib/tokens';

/**
 * Two routes, on purpose.
 *
 * Corporate mail scanners, link previewers and antivirus proxies fetch URLs
 * out of email before a human ever clicks. A single route that streams and
 * decrements would burn a customer's five downloads before they opened the
 * message. So:
 *
 *   GET  /d/:token        -> HTML landing page. Consumes NOTHING.
 *   GET  /d/:token/file   -> the stream. Consumes exactly one.
 *   HEAD /d/:token/file   -> ignored entirely, never counted.
 *   POST /d/:token/reissue-> mails a fresh link to the buyer's address.
 */

type State = 'ok' | 'expired' | 'exhausted' | 'revoked';

function stateOf(row: TokenRow): State {
  if (row.revoked_at) return 'revoked';
  if (Date.parse(row.expires_at) <= Date.now()) return 'expired';
  if (row.download_count >= row.max_downloads) return 'exhausted';
  return 'ok';
}

function parseFormat(url: URL): Format | null {
  const raw = url.searchParams.get('format');
  if (raw === 'wav' || raw === 'mp3') return raw;
  return null;
}

/* ------------------------------------------------------------------ */
/* what a given album actually offers                                  */
/* ------------------------------------------------------------------ */

/**
 * Music ships as two encodings of one record. A sample pack ships as one zip,
 * and a bundle ships as two different packs. Same two key slots underneath,
 * three different things to say about them -- so every customer-facing name
 * comes through here rather than off `formatLabel`, which only knows encodings.
 */
interface DownloadPart {
  format: Format;
  label: string;
}

/**
 * A bundle's parts are ordinary album rows; the bundle row just points its two
 * key slots at their zips. Reading the part title back out of D1 keeps product
 * names in the catalog where the rest of them live. Null when the key is not
 * `albums/{slug}/...` or the row is gone -- callers fall back to a positional
 * name rather than mislabelling a download.
 */
async function partTitle(env: Env, album: AlbumRow, format: Format): Promise<string | null> {
  const slug = slugFromR2Key(r2KeyFor(album, format));
  if (!slug) return null;
  const part = await getAlbum(env, slug);
  return part?.title ?? null;
}

// WORKSHOP: the button labels and fallbacks below are placeholder copy.
async function partsFor(env: Env, album: AlbumRow): Promise<DownloadPart[]> {
  if (album.kind === 'pack') {
    // One zip. The mp3 slot holds the same key, so a second button would be a
    // second name for the same file.
    return [{ format: 'wav', label: 'download pack (wav)' }];
  }
  if (album.kind === 'bundle') {
    const [wav, mp3] = await Promise.all([
      partTitle(env, album, 'wav'),
      partTitle(env, album, 'mp3'),
    ]);
    return [
      { format: 'wav', label: wav ?? 'download the first pack' },
      { format: 'mp3', label: mp3 ?? 'download the second pack' },
    ];
  }
  return [
    { format: 'wav', label: 'download WAV' },
    { format: 'mp3', label: 'download MP3 320' },
  ];
}

/**
 * The name the file lands under. Packs are WAV whichever slot was asked for,
 * and a bundle's two slots are two separate packs, so neither can use the
 * plain encoding label.
 */
async function downloadFilename(env: Env, album: AlbumRow, format: Format): Promise<string> {
  if (album.kind === 'pack') return `${album.title} (WAV).zip`;
  if (album.kind === 'bundle') {
    return `${(await partTitle(env, album, format)) ?? album.title} (WAV).zip`;
  }
  return `${album.title} (${formatLabel(format)}).zip`;
}

/* ------------------------------------------------------------------ */
/* GET /d/:token -- landing page                                       */
/* ------------------------------------------------------------------ */

export async function handleLanding(
  req: Request,
  env: Env,
  _ctx: Ctx,
  params: Record<string, string>,
): Promise<Response> {
  const token = params.token ?? '';
  if (!looksLikeToken(token)) return generic404();

  const { success } = await env.DOWNLOAD_LIMITER.limit({ key: clientIp(req) });
  if (!success) return html(page('slow down', `<h1>slow down</h1><p>too many requests. try again in a minute.</p>`), { status: 429 });

  const row = await getToken(env, token);
  if (!row) {
    await logDownloadEvent(env, token, 'notfound', null, ipCountry(req), req.headers.get('User-Agent'));
    return generic404();
  }

  const album = await getAlbum(env, row.album_slug);
  if (!album) {
    await alert(env, 'landing_album_missing', `token for "${row.album_slug}" but no such album row`);
    return html(page('something is wrong', problemBody()), { status: 500 });
  }

  const state = stateOf(row);
  await logDownloadEvent(env, token, `landing_${state}`, null, ipCountry(req), req.headers.get('User-Agent'));

  if (state === 'ok') {
    const parts = await partsFor(env, album);
    return html(page(album.title, okBody(album, row, token, parts)));
  }
  return html(page(album.title, blockedBody(album, token, state)), { status: 403 });
}

// WORKSHOP: every customer-facing line in the three page bodies below is
// placeholder copy. Matthew's wording replaces it verbatim.
function okBody(
  album: AlbumRow,
  row: TokenRow,
  token: string,
  parts: DownloadPart[],
): string {
  const remaining = row.max_downloads - row.download_count;
  const base = `/d/${encodeURIComponent(token)}/file`;

  const buttons = parts
    .map(
      (part, i) =>
        `  <a class="btn${i === 0 ? '' : ' secondary'}" href="${escapeHtml(base)}?format=${part.format}">${escapeHtml(part.label)}</a>`,
    )
    .join('\n');

  // The "shared across" wording has to match what is actually on the page: two
  // formats of one record, one zip, or two separate packs.
  const lead =
    album.kind === 'pack'
      ? 'your pack is ready.'
      : album.kind === 'bundle'
        ? 'both packs are on this page.'
        : 'your download is ready. pick a format.';
  const sharedAcross =
    album.kind === 'pack'
      ? ''
      : album.kind === 'bundle'
        ? ', shared across both packs'
        : ', shared across both formats';

  return `<h1>${escapeHtml(album.title)}</h1>
<p class="lead">${escapeHtml(lead)}</p>
<div class="actions">
${buttons}
</div>
<p class="meta">${remaining} download${remaining === 1 ? '' : 's'} left${sharedAcross}.
link expires ${escapeHtml(row.expires_at.slice(0, 16).replace('T', ' '))} UTC.</p>
<hr>
<p class="meta">opening this page costs nothing &mdash; only the buttons above count.</p>`;
}

function blockedBody(album: AlbumRow, token: string, state: State): string {
  const action = `/d/${encodeURIComponent(token)}/reissue`;
  if (state === 'revoked') {
    return `<h1>${escapeHtml(album.title)}</h1>
<p class="lead">this link has been turned off.</p>
<p>that usually means the payment was refunded or disputed. if you think that's wrong, reply to the email this link came from and it reaches matthew directly.</p>`;
  }
  const reason =
    state === 'expired'
      ? 'this link has expired.'
      : 'this link has used up its downloads.';
  return `<h1>${escapeHtml(album.title)}</h1>
<p class="lead">${escapeHtml(reason)}</p>
<p>that's fixable. a fresh link goes to the same email address you bought with &mdash; nobody else can request it, and it never appears on this page.</p>
<form method="post" action="${escapeHtml(action)}">
  <button class="btn" type="submit">email me a new link</button>
</form>`;
}

function problemBody(): string {
  return `<h1>something is wrong on my end</h1>
<p>your download was not counted. reply to the email this link came from and matthew will sort it out.</p>`;
}

/* ------------------------------------------------------------------ */
/* HEAD /d/:token/file -- ignored                                      */
/* ------------------------------------------------------------------ */

export function handleFileHead(): Response {
  // Never counted, never touches D1. Scanners issue HEAD constantly.
  return new Response(null, {
    status: 200,
    headers: { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store' },
  });
}

/* ------------------------------------------------------------------ */
/* GET /d/:token/file -- the stream                                    */
/* ------------------------------------------------------------------ */

export async function handleFile(
  req: Request,
  env: Env,
  _ctx: Ctx,
  params: Record<string, string>,
): Promise<Response> {
  const token = params.token ?? '';
  if (!looksLikeToken(token)) return generic404();

  const { success } = await env.DOWNLOAD_LIMITER.limit({ key: clientIp(req) });
  if (!success) return html(page('slow down', `<h1>slow down</h1><p>too many requests. try again in a minute.</p>`), { status: 429 });

  const url = new URL(req.url);
  const format = parseFormat(url);
  if (!format) {
    return html(
      page('which format?', `<h1>which format?</h1><p>use <code>?format=wav</code> or <code>?format=mp3</code>.</p>`),
      { status: 400 },
    );
  }

  const country = ipCountry(req);
  const ua = req.headers.get('User-Agent');

  const row = await getToken(env, token);
  if (!row) {
    await logDownloadEvent(env, token, 'notfound', format, country, ua);
    return generic404();
  }

  const album = await getAlbum(env, row.album_slug);
  if (!album) {
    await logDownloadEvent(env, token, 'r2_missing', format, country, ua);
    await alert(env, 'file_album_missing', `token ${token.slice(0, 8)}... references missing album "${row.album_slug}"`);
    return html(page('something is wrong', problemBody()), { status: 500 });
  }

  // The atomic consume. Every precondition lives in the WHERE clause, so two
  // clicks racing at count = 4 cannot both win.
  const consumed = await consumeDownload(env, token);
  if (!consumed) {
    const state = stateOf(row);
    await logDownloadEvent(env, token, state === 'ok' ? 'exhausted' : state, format, country, ua);
    return html(page(album.title, blockedBody(album, token, state === 'ok' ? 'exhausted' : state)), {
      status: 403,
    });
  }

  const key = r2KeyFor(album, format);
  const object = await env.ALBUMS.get(key);
  if (!object) {
    // Our missing file, not their spent download. Give it back.
    await refundDownload(env, token);
    await logDownloadEvent(env, token, 'r2_missing', format, country, ua);
    await alert(
      env,
      'r2_object_missing',
      `R2 key "${key}" for album "${album.slug}" (${format}) is missing. ` +
        `The download was refunded to the customer. Upload the file.`,
    );
    return html(page('something is wrong', problemBody()), { status: 500 });
  }

  await logDownloadEvent(env, token, 'served', format, country, ua);

  const headers = new Headers({
    'Content-Type': 'application/zip',
    'Content-Disposition': contentDisposition(await downloadFilename(env, album, format)),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if (object.size) headers.set('Content-Length', String(object.size));

  // Streamed, not buffered: a large ZIP must never sit in Worker memory.
  return new Response(object.body, { status: 200, headers });
}

/* ------------------------------------------------------------------ */
/* POST /d/:token/reissue                                              */
/* ------------------------------------------------------------------ */

export async function handleReissue(
  req: Request,
  env: Env,
  ctx: Ctx,
  params: Record<string, string>,
): Promise<Response> {
  const token = params.token ?? '';
  if (!looksLikeToken(token)) return generic404();

  const { success } = await env.DOWNLOAD_LIMITER.limit({ key: clientIp(req) });
  if (!success) return html(page('slow down', `<h1>slow down</h1><p>too many requests. try again in a minute.</p>`), { status: 429 });

  const row = await getToken(env, token);
  if (!row) return generic404();

  const purchase = await env.DB.prepare(
    `SELECT id, email, status FROM purchases WHERE id = ?1`,
  )
    .bind(row.purchase_id)
    .first<{ id: string; email: string; status: string }>();

  // A revoked token means refunded or disputed. Reissuing there would hand
  // the file back to someone who has their money back.
  if (!purchase || purchase.status !== 'paid' || row.revoked_at) {
    return html(page('no', `<h1>can't reissue that</h1><p>reply to the email this link came from and matthew will look at it.</p>`), {
      status: 403,
    });
  }

  const album = await getAlbum(env, row.album_slug);
  if (!album) {
    await alert(env, 'reissue_album_missing', `cannot reissue: album "${row.album_slug}" is gone`);
    return html(page('something is wrong', problemBody()), { status: 500 });
  }

  // Cap the chain: 1 original + 3 reissues per purchase. Past that, a human
  // looks at it — unlimited reissue would let anyone holding one expired
  // token mint links (and emails to the buyer) forever.
  const minted = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM download_tokens WHERE purchase_id = ?1`,
  )
    .bind(purchase.id)
    .first<{ n: number }>();
  if ((minted?.n ?? 0) >= 4) {
    await alert(
      env,
      'reissue_cap_hit',
      `purchase ${purchase.id} (${row.album_slug}) hit the reissue cap; buyer may need manual help`,
    );
    return html(
      page(
        'limit reached',
        `<h1>that's the limit on automatic re-sends</h1><p>reply to the email this link came from and matthew will sort it out personally.</p>`,
      ),
      { status: 429 },
    );
  }

  const fresh = await createDownloadToken(env, purchase.id, row.album_slug);
  await logDownloadEvent(env, token, 'reissued', null, ipCountry(req), req.headers.get('User-Agent'));
  await enqueue(env, purchase.email, 'download_reissued', {
    token: fresh,
    album_title: album.title,
    album_slug: album.slug,
    ttl_hours: intVar(env.DOWNLOAD_TTL_HOURS, 72),
    max_downloads: intVar(env.MAX_DOWNLOADS, 5),
  });
  ctx.waitUntil(drainOutbox(env).catch(() => undefined));

  return html(
    page(
      'on its way',
      `<h1>on its way</h1>
<p class="lead">a fresh link is heading to the address you bought with.</p>
<p>give it a minute, and check spam if it doesn't show. the address is not displayed here on purpose.</p>`,
    ),
  );
}
