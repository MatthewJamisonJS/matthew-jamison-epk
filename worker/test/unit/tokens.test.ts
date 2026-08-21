import { describe, expect, it } from 'vitest';
import {
  contentDisposition,
  looksLikeToken,
  newToken,
  normalizeEmail,
  timingSafeEqual,
} from '../../src/lib/tokens';

describe('token minting', () => {
  it('produces 32 bytes of entropy as base64url', () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes -> 43 base64 chars once padding is stripped
    expect(t.length).toBe(43);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newToken()));
    expect(seen.size).toBe(500);
  });
});

describe('looksLikeToken', () => {
  it('accepts a freshly minted token', () => {
    expect(looksLikeToken(newToken())).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['too short', 'abc'],
    ['path traversal', '../../etc/passwd'],
    ['sql-ish', "' OR 1=1 --"],
    ['null byte', 'aaaaaaaaaaaaaaaa' + String.fromCharCode(0)],
    ['trailing space', 'aaaaaaaaaaaaaaaa '],
    ['absurdly long', 'a'.repeat(500)],
    ['percent escape', 'aaaaaaaaaaaaaaaa%2e%2e'],
  ])('rejects %s', (_label, value) => {
    expect(looksLikeToken(value)).toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('matches identical strings', () => {
    expect(timingSafeEqual('correct-horse-battery-staple', 'correct-horse-battery-staple')).toBe(
      true,
    );
  });

  it('rejects a one-character difference', () => {
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
  });

  it('rejects a correct prefix of the right token', () => {
    // The case that a naive early-return compare leaks.
    expect(timingSafeEqual('abc', 'abcdef')).toBe(false);
    expect(timingSafeEqual('abcdef', 'abc')).toBe(false);
  });

  it('rejects the empty string against a real token', () => {
    expect(timingSafeEqual('', 'abcdef')).toBe(false);
  });

  it('handles multibyte input without throwing', () => {
    expect(timingSafeEqual('ryōkō', 'ryōkō')).toBe(true);
    expect(timingSafeEqual('ryōkō', 'ryoko')).toBe(false);
  });
});

describe('contentDisposition', () => {
  it('keeps a plain filename readable', () => {
    const h = contentDisposition('perspective (MP3 320).zip');
    expect(h).toContain('filename="perspective (MP3 320).zip"');
  });

  it('strips CR and LF so a title cannot inject a header', () => {
    const h = contentDisposition('evil\r\nSet-Cookie: a=b (WAV).zip');
    expect(h).not.toContain('\r');
    expect(h).not.toContain('\n');
    expect(h.toLowerCase()).not.toContain('set-cookie: a=b (wav).zip"');
  });

  it('strips the quote that would close the parameter early', () => {
    const h = contentDisposition('a" ; x="b');
    const quoted = /filename="([^"]*)"/.exec(h);
    expect(quoted).not.toBeNull();
    expect(quoted![1]).not.toContain('"');
  });

  it('strips path separators', () => {
    const h = contentDisposition('../../etc/passwd');
    expect(h).toContain('filename="....etcpasswd"');
  });

  it('offers UTF-8 via filename* while keeping ASCII in filename', () => {
    const h = contentDisposition('ryōkō (WAV).zip');
    expect(h).toContain("filename*=UTF-8''");
    expect(/filename="([^"]*)"/.exec(h)![1]).toMatch(/^[\x20-\x7E]*$/);
  });

  it('never returns an empty filename', () => {
    expect(contentDisposition('////')).toContain('filename="download.zip"');
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases, because email is the primary key', () => {
    expect(normalizeEmail('  A@X.com ')).toBe('a@x.com');
    expect(normalizeEmail('a@x.com')).toBe('a@x.com');
  });

  it('does NOT strip plus-addressing', () => {
    // a+music@x.com is a distinct address the person deliberately chose.
    expect(normalizeEmail('A+Music@X.com')).toBe('a+music@x.com');
  });
});
