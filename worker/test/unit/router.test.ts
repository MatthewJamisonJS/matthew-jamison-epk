import { describe, expect, it } from 'vitest';
import { Router } from '../../src/lib/router';

const ok = () => new Response('ok');

function build() {
  return new Router()
    .get('/health', ok)
    .post('/checkout', ok)
    .get('/d/:token', ok)
    .get('/d/:token/file', ok)
    .head('/d/:token/file', ok)
    .post('/d/:token/reissue', ok)
    .get('/admin/export', ok);
}

describe('router', () => {
  const r = build();

  it('matches a static route', () => {
    expect(r.match('GET', '/health')).not.toBeNull();
  });

  it('tolerates a trailing slash', () => {
    expect(r.match('GET', '/health/')).not.toBeNull();
  });

  it('separates the landing route from the file route', () => {
    expect(r.match('GET', '/d/abc')?.params.token).toBe('abc');
    expect(r.match('GET', '/d/abc/file')?.params.token).toBe('abc');
  });

  it('keeps HEAD on the file route distinct from GET', () => {
    // HEAD must reach the handler that counts nothing.
    expect(r.match('HEAD', '/d/abc/file')).not.toBeNull();
    expect(r.match('HEAD', '/d/abc')).toBeNull();
  });

  it('does not match on method alone', () => {
    expect(r.match('GET', '/checkout')).toBeNull();
    expect(r.match('DELETE', '/health')).toBeNull();
  });

  it('does not partially match a longer path', () => {
    expect(r.match('GET', '/d/abc/file/extra')).toBeNull();
    expect(r.match('GET', '/health/extra')).toBeNull();
  });

  it('does not let a param swallow a slash', () => {
    expect(r.match('GET', '/d/a/b')).toBeNull();
  });

  it('decodes a percent-escaped segment', () => {
    expect(r.match('GET', '/d/a%2Db')?.params.token).toBe('a-b');
  });

  it('does not let an encoded slash forge a path', () => {
    // %2F decodes to "/" but the split already happened, so it stays inside
    // the token param and is rejected downstream by looksLikeToken.
    expect(r.match('GET', '/d/abc%2Ffile')?.params.token).toBe('abc/file');
  });

  it('returns null for an unknown path', () => {
    expect(r.match('GET', '/wp-admin')).toBeNull();
    expect(r.match('GET', '/')).toBeNull();
  });
});
