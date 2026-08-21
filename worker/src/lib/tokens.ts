/** 32 bytes of CSPRNG entropy, base64url. ~256 bits: not guessable. */
export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Outbox / export row ids. Not a secret, just needs to be unique. */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

/**
 * Constant-time string compare. Used for the fallback admin bearer token so a
 * wrong guess cannot be narrowed by timing. Length is compared by folding it
 * into the accumulator rather than by an early return.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ba.length ^ bb.length;
  const n = Math.max(ba.length, bb.length);
  for (let i = 0; i < n; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * A token that came off the wire. Anything outside the base64url alphabet or
 * outside a sane length never reaches D1 -- it is a generic 404 immediately.
 */
export function looksLikeToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(s);
}

/**
 * Content-Disposition filename. Header injection via a CRLF in an album title
 * is the risk; so is a quote closing the parameter early. Strip to a safe
 * ASCII set for `filename=` and hand UTF-8 to `filename*` (RFC 5987).
 */
export function contentDisposition(rawName: string): string {
  const collapsed = rawName.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  const ascii =
    collapsed
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/["\\/:*?<>|]/g, '')
      .trim()
      .slice(0, 120) || 'download.zip';
  const utf8 = encodeRFC5987(collapsed.slice(0, 120) || 'download.zip');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

function encodeRFC5987(s: string): string {
  return encodeURIComponent(s)
    .replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%(7C|60|5E)/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Email is the subscribers primary key, so normalization must be exact. */
export function normalizeEmail(raw: string): string {
  // Trim + lowercase only. Plus-addressing is NOT stripped: a+music@x.com is a
  // distinct address the person deliberately chose.
  return raw.trim().toLowerCase();
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}
