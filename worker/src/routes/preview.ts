import type { Ctx, Env } from '../types';
import { generic404 } from '../lib/http';

/**
 * GET /p/:slug/:track  -- public 128 kbps preview stream.
 *
 * Serves previews/{slug}/{NN}.mp3 from R2. Range requests are honoured so
 * <audio> scrubbing works; responses are immutable-cached at the edge (the
 * files are content-stable, re-encoding a track would ship under a new NN
 * only by convention -- acceptable for previews).
 *
 * Deliberately public: previews are the storefront, the paid zips under
 * albums/ stay token-gated. The key shape is locked down so this route can
 * never read outside previews/.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TRACK_RE = /^\d{2}$/;

export async function handlePreview(
  req: Request,
  env: Env,
  _ctx: Ctx,
  params: Record<string, string>,
): Promise<Response> {
  const slug = params.slug ?? '';
  const track = params.track ?? '';
  if (!SLUG_RE.test(slug) || !TRACK_RE.test(track)) return generic404();

  const key = `previews/${slug}/${track}.mp3`;
  const rangeHeader = req.headers.get('Range');

  const object = rangeHeader
    ? await env.ALBUMS.get(key, { range: req.headers })
    : await env.ALBUMS.get(key);
  if (!object) return generic404();

  const headers = new Headers({
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    'X-Content-Type-Options': 'nosniff',
  });

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
