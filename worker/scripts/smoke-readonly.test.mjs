import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smokeReadonly } from './smoke-readonly.mjs';

function responseFor(url, init) {
  const path = new URL(url).pathname;
  const cors = { 'access-control-allow-origin': 'https://matthewjamison.dev' };
  if (path === '/health') return Response.json({ ok: true, service: 'mj-music' }, { headers: { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });
  if (path === '/__security_deploy_probe__') return new Response('', { status: 404 });
  if (init.method === 'OPTIONS') return new Response(null, init.headers.Origin === 'https://invalid.example' ? { status: 403 } : { status: 204, headers: cors });
  if (path === '/admin/export') return new Response(null, { status: 302, headers: { location: 'https://jamisonsoftware.cloudflareaccess.com/cdn-cgi/access/login/api.matthewjamison.dev' } });
  return new Response(new Uint8Array(32), { status: 206, headers: { ...cors, 'content-type': 'audio/flac', 'content-range': 'bytes 0-31/1000', 'content-length': '32' } });
}

test('smoke only uses approved read-only production requests and never follows redirects', async () => {
  const calls = [];
  const results = await smokeReadonly(async (url, init) => {
    calls.push({ url, init });
    assert.equal(new URL(url).origin, 'https://api.matthewjamison.dev');
    assert.ok(['GET', 'OPTIONS'].includes(init.method ?? 'GET'));
    assert.equal(init.redirect, 'manual');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.body, undefined);
    assert.equal(init.headers?.Authorization, undefined);
    return responseFor(url, init);
  });
  assert.equal(results.length, 8);
  assert.equal(calls.length, 8);
});

test('smoke rejects public admin access and stops without following it', async () => {
  let calls = 0;
  await assert.rejects(smokeReadonly(async (url, init) => {
    calls++;
    return new URL(url).pathname === '/admin/export' ? new Response('private data') : responseFor(url, init);
  }));
  assert.equal(calls, 7);
});

test('smoke rejects redirect outside the actual Access tenant', async () => {
  await assert.rejects(smokeReadonly(async (url, init) => new URL(url).pathname === '/admin/export'
    ? new Response(null, { status: 302, headers: { location: 'https://attacker.example/cdn-cgi/access/login/api.matthewjamison.dev' } })
    : responseFor(url, init)));
});

test('smoke rejects full-file audio responses without consuming the body', async () => {
  let full;
  await assert.rejects(smokeReadonly(async (url, init) => {
    if (new URL(url).pathname.startsWith('/s/') && init.method !== 'OPTIONS') {
      full = new Response('unexpected full file');
      return full;
    }
    return responseFor(url, init);
  }));
  assert.equal(full.bodyUsed, true); // canceled rather than downloaded
});

test('smoke rejects unhealthy service before issuing later requests', async () => {
  let calls = 0;
  await assert.rejects(smokeReadonly(async () => { calls++; return new Response('failure', { status: 500 }); }));
  assert.equal(calls, 1);
});
