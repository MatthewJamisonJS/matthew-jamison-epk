import type { Env } from '../types';

/**
 * CSP for pages THIS WORKER renders. Deliberately not the site's CSP: these
 * pages are self-contained, ship one inline <style>, and carry no JS at all.
 * `script-src 'none'` is the load-bearing line -- everything interactive here
 * is a plain anchor or a form POST.
 */
export const PAGE_CSP =
  "default-src 'none'; " +
  "style-src 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "form-action 'self'; " +
  "base-uri 'none'; " +
  "frame-ancestors 'none'";

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
};

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

export function html(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': PAGE_CSP,
      ...SECURITY_HEADERS,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

export function text(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

/**
 * ONE 404 body for every token failure -- unknown, malformed, wrong shape.
 * A distinguishable response is an oracle that turns a token guess into a
 * search. Expired/exhausted tokens get a friendlier page, but only because
 * presenting one proves the holder already had a real token.
 */
export function generic404(): Response {
  return html(
    page('not found', `<h1>not found</h1><p>that link doesn't point at anything.</p>`),
    { status: 404 },
  );
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Self-contained page shell. One inline <style>, zero script, zero requests. */
export function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; --bg:#faf9f7; --fg:#1b1b1b; --muted:#5f5f5f;
        --line:#dcdad5; --accent:#1b1b1b; --accent-fg:#faf9f7; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#111; --fg:#f2f0ec; --muted:#a3a3a3; --line:#333;
          --accent:#f2f0ec; --accent-fg:#111; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font: 16px/1.6
  ui-monospace, SFMono-Regular, Menlo, "JetBrains Mono", monospace;
  display:flex; min-height:100vh; align-items:center; justify-content:center; padding:2rem 1rem; }
main { width:100%; max-width:34rem; }
h1 { font-size:1.35rem; font-weight:600; margin:0 0 .75rem; letter-spacing:-.01em; }
h2 { font-size:1rem; font-weight:600; margin:1.75rem 0 .5rem; }
p { margin:0 0 1rem; color:var(--muted); }
p.lead { color:var(--fg); }
ul { margin:0 0 1rem; padding-left:1.1rem; color:var(--muted); }
hr { border:0; border-top:1px solid var(--line); margin:1.75rem 0; }
.actions { display:flex; flex-wrap:wrap; gap:.75rem; margin:1.25rem 0; }
a.btn, button.btn {
  display:inline-block; padding:.7rem 1.15rem; border:1px solid var(--accent);
  border-radius:.35rem; background:var(--accent); color:var(--accent-fg);
  text-decoration:none; font:inherit; font-weight:600; cursor:pointer; }
a.btn.secondary, button.btn.secondary { background:transparent; color:var(--fg); border-color:var(--line); }
a.btn:focus-visible, button.btn:focus-visible { outline:3px solid #4c8bf5; outline-offset:2px; }
.meta { font-size:.85rem; color:var(--muted); }
form { display:inline; }
code { background:rgba(127,127,127,.15); padding:.1rem .3rem; border-radius:.2rem; }
</style>
</head>
<body>
<main>
${bodyHtml}
</main>
</body>
</html>`;
}

/**
 * CORS for the browser-facing JSON route. The allowed origin is the single
 * configured site origin -- never a reflected Origin header, never `*`.
 */
export function corsHeaders(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  if (origin !== env.SITE_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin': env.SITE_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/**
 * CORS for the public stream routes. Media element loads are no-cors and
 * ignore these; they exist for the player's ranged throughput probe, which is
 * a real CORS fetch. Applied per-request after the cache lookup, so cached
 * entries stay origin-neutral.
 */
export function streamCorsHeaders(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  if (origin !== env.SITE_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin': env.SITE_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function clientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
}

export function ipCountry(req: Request): string | null {
  const cf = (req as Request & { cf?: IncomingRequestCfProperties }).cf;
  return (cf?.country as string | undefined) ?? null;
}
