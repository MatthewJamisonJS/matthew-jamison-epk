import type { Ctx, Env } from '../types';
import { generic404, streamCorsHeaders } from '../lib/http';

/**
 * GET /p/:slug/:track  -- public 128 kbps preview stream (previews/{slug}/{NN}.mp3)
 * GET /s/:slug/:track  -- public lossless stream        (stream/{slug}/{NN}.flac)
 *
 * Range requests are honoured so <audio> scrubbing works.
 *
 * Both routes sit behind the Cache API (`caches.default`), so a repeat play
 * costs no R2 read: `cache.match(req)` slices a stored full 200 down to the
 * request's Range and answers If-None-Match with a 304 on its own. Only full
 * 200s are ever stored -- cache.put rejects a 206 -- and a ranged miss warms
 * the cache in the background so that the very first (always ranged) play
 * still populates it. The files are content-stable: re-encoding a track would
 * ship under a new NN only by convention, which is acceptable here.
 *
 * Deliberately public: on-site streaming is the storefront (stream free, buy
 * to own), the paid zips under albums/ stay token-gated. The key shape is
 * locked down so these routes can never read outside their prefixes.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TRACK_RE = /^\d{2}$/;

/** If-None-Match is a list, and may be `*` -- an exact-string compare misses both. */
function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const value = header.trim();
  if (value === '*') return true;
  return value.split(',').some((token) => token.trim() === etag);
}

function audioHeaders(contentType: string, etag: string): Headers {
  return new Headers({
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
  });
}

async function serveAudio(
  req: Request,
  env: Env,
  ctx: Ctx,
  params: Record<string, string>,
  prefix: 'previews' | 'stream',
  ext: string,
  contentType: string,
): Promise<Response> {
  const slug = params.slug ?? '';
  const track = params.track ?? '';
  if (!SLUG_RE.test(slug) || !TRACK_RE.test(track)) return generic404();

  const key = `${prefix}/${slug}/${track}.${ext}`;
  const cache = caches.default;
  // put/warm always key off a bare GET of the URL -- a key carrying a Range
  // header would store one entry per byte window. Lookups pass the original
  // request so the cache can slice a 206 and answer If-None-Match itself.
  const cacheKey = new Request(new URL(req.url).toString());

  const hit = await cache.match(req);
  if (hit) return hit;

  // full-object path: also the fallback when a client's Range is unusable
  const serveFull = async (): Promise<Response> => {
    const object = await env.ALBUMS.get(key);
    if (!object) return generic404();

    const headers = audioHeaders(contentType, object.httpEtag);

    if (etagMatches(req.headers.get('If-None-Match'), object.httpEtag)) {
      return new Response(null, { status: 304, headers });
    }

    headers.set('Content-Length', String(object.size));
    const response = new Response(object.body, { status: 200, headers });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  };

  if (!req.headers.get('Range')) return serveFull();

  // R2 throws on an unsatisfiable or malformed Range -- a bad client header
  // must not 500 a public stream route, so fall back to the whole object.
  let object: R2ObjectBody | null;
  try {
    object = await env.ALBUMS.get(key, { range: req.headers });
  } catch {
    return serveFull();
  }
  if (!object) return generic404();

  // browsers open media with `Range: bytes=0-`, so a ranged request is the
  // normal first touch. cache.put refuses a 206, so read the object a second
  // time off the response path and store the full 200 -- otherwise the cache
  // would never populate and every play would hit R2.
  ctx.waitUntil(
    (async () => {
      try {
        const full = await env.ALBUMS.get(key);
        if (!full) return;
        const headers = audioHeaders(contentType, full.httpEtag);
        headers.set('Content-Length', String(full.size));
        await cache.put(cacheKey, new Response(full.body, { status: 200, headers }));
      } catch {
        // a failed warm just means the next request tries again
      }
    })(),
  );

  const headers = audioHeaders(contentType, object.httpEtag);

  if (object.range && 'offset' in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}

export async function handlePreview(
  req: Request,
  env: Env,
  ctx: Ctx,
  params: Record<string, string>,
): Promise<Response> {
  return serveAudio(req, env, ctx, params, 'previews', 'mp3', 'audio/mpeg');
}

export async function handleStreamPreflight(req: Request, env: Env): Promise<Response> {
  const cors = streamCorsHeaders(env, req);
  if (Object.keys(cors).length === 0) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204, headers: cors });
}

export async function handleStream(
  req: Request,
  env: Env,
  ctx: Ctx,
  params: Record<string, string>,
): Promise<Response> {
  const res = await serveAudio(req, env, ctx, params, 'stream', 'flac', 'audio/flac');
  const cors = streamCorsHeaders(env, req);
  if (Object.keys(cors).length === 0) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) {
    if (k === 'Vary') headers.append(k, v);
    else headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, headers });
}
