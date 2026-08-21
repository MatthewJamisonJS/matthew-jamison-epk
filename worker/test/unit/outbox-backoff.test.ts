import { describe, expect, it } from 'vitest';
import { BACKOFF_MS, backoffMs, isExhausted, MAX_ATTEMPTS } from '../../src/lib/outbox';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('outbox backoff schedule', () => {
  it('follows 1m, 5m, 30m, 2h, 12h', () => {
    expect(BACKOFF_MS).toEqual([1 * MINUTE, 5 * MINUTE, 30 * MINUTE, 2 * HOUR, 12 * HOUR]);
  });

  it('maps the Nth failure to the Nth wait', () => {
    expect(backoffMs(1)).toBe(1 * MINUTE);
    expect(backoffMs(2)).toBe(5 * MINUTE);
    expect(backoffMs(3)).toBe(30 * MINUTE);
    expect(backoffMs(4)).toBe(2 * HOUR);
    expect(backoffMs(5)).toBe(12 * HOUR);
  });

  it('is strictly increasing, so a dead provider is not hammered', () => {
    for (let i = 2; i <= BACKOFF_MS.length; i++) {
      expect(backoffMs(i)).toBeGreaterThan(backoffMs(i - 1));
    }
  });

  it('clamps out-of-range attempts instead of returning undefined', () => {
    expect(backoffMs(0)).toBe(1 * MINUTE);
    expect(backoffMs(-3)).toBe(1 * MINUTE);
    expect(backoffMs(99)).toBe(12 * HOUR);
    expect(Number.isFinite(backoffMs(99))).toBe(true);
  });

  it('gives up at MAX_ATTEMPTS and not before', () => {
    expect(MAX_ATTEMPTS).toBe(5);
    for (let i = 1; i < MAX_ATTEMPTS; i++) expect(isExhausted(i)).toBe(false);
    expect(isExhausted(MAX_ATTEMPTS)).toBe(true);
    expect(isExhausted(MAX_ATTEMPTS + 1)).toBe(true);
  });

  it('spans roughly half a day of retries before failing', () => {
    // Four waits are actually served (the fifth failure marks the row failed).
    const served = BACKOFF_MS.slice(0, MAX_ATTEMPTS - 1).reduce((a, b) => a + b, 0);
    expect(served).toBeGreaterThan(2 * HOUR);
    expect(served).toBeLessThan(4 * HOUR);
  });
});
