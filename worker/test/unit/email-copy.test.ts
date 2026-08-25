import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { render } from '../../src/lib/email';

/**
 * The delivery email describes what is waiting on the download page. Getting
 * that wrong is a support ticket: a pack buyer told to expect two formats goes
 * looking for an MP3 that does not exist.
 */

function ready(kind: string, title = 'A Thing') {
  return render(env, 'download_ready', {
    token: 'tok_abcdefghijklmnop',
    album_title: title,
    album_slug: 'a-thing',
    album_kind: kind,
    ttl_hours: 72,
    max_downloads: 5,
  });
}

describe('download_ready copy per album kind', () => {
  it('promises both formats for a record', () => {
    const m = ready('album', 'Example Album');
    expect(m.text).toContain('both formats are on it -- WAV and MP3 320');
    expect(m.text).toContain('counted across both formats');
    expect(m.html).toContain('MP3&nbsp;320');
  });

  it('says one zip for a pack, and claims no second format', () => {
    const m = ready('pack', 'INFINITY LOOPS');
    expect(m.text).toContain('the pack is one zip file');
    expect(m.text).not.toContain('both formats');
    expect(m.text).not.toContain('MP3');
    expect(m.html).not.toContain('both formats');
    expect(m.html).not.toContain('MP3');
    // The limits line keeps the numbers but drops the "across formats" claim.
    expect(m.text).toContain('allows 5 downloads in total.');
  });

  it('says two packs on one page, downloads shared, for a bundle', () => {
    const m = ready('bundle', 'BASS SAMPLE PACKS BUNDLE');
    expect(m.text).toContain('both packs are on it');
    expect(m.text).toContain('counted across both packs');
    expect(m.text).not.toContain('both formats');
    expect(m.html).toContain('counted across both packs');
  });

  it('keeps the subject and support lines the same across kinds', () => {
    for (const kind of ['album', 'pack', 'bundle']) {
      const m = ready(kind);
      expect(m.subject).toBe('A Thing is ready to download');
      expect(m.text).toContain('just reply to this email and it reaches me');
      expect(m.text).toContain(`${env.WORKER_ORIGIN}/d/tok_abcdefghijklmnop`);
    }
  });

  it('falls back to record wording when no kind is in the payload', () => {
    // Tokens minted before this change have no album_kind in their outbox row.
    const m = render(env, 'download_ready', { token: 't', album_title: 'X', ttl_hours: 72, max_downloads: 5 });
    expect(m.text).toContain('both formats');
  });
});

describe('download_reissued is untouched by kind', () => {
  it('renders the same body whatever kind is passed', () => {
    const a = render(env, 'download_reissued', {
      token: 't', album_title: 'X', album_kind: 'pack', ttl_hours: 72, max_downloads: 5,
    });
    const b = render(env, 'download_reissued', {
      token: 't', album_title: 'X', album_kind: 'album', ttl_hours: 72, max_downloads: 5,
    });
    expect(a).toEqual(b);
    expect(a.text).toContain('here is a new link for X');
  });
});
