import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

// No credentials, POST requests, purchased-download tokens, scheduled handlers,
// or email endpoints. A public audio GET may populate the ordinary edge cache.
export async function smokeReadonly(fetcher = fetch) {
  const origin = 'https://api.matthewjamison.dev';
  const site = 'https://matthewjamison.dev';
  const results = [];
  const check = async (name, path, init, validate) => {
    const response = await fetcher(origin + path, {
      ...init, redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    try {
      await validate(response);
      results.push({ name, status: response.status });
    } finally {
      if (!response.bodyUsed) await response.body?.cancel();
    }
  };
  const status = (response, expected) => assert.equal(response.status, expected);
  await check('health', '/health', {}, async r => {
    status(r, 200);
    assert.deepEqual(await r.json(), { ok: true, service: 'mj-music' });
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });
  await check('not-found', '/__security_deploy_probe__', {}, r => status(r, 404));
  for (const path of ['/checkout', '/subscribe', '/s/beat-tape-1/01']) {
    await check(`preflight ${path}`, path, {
      method: 'OPTIONS', headers: { Origin: site, 'Access-Control-Request-Method': path.startsWith('/s/') ? 'GET' : 'POST' },
    }, r => {
      status(r, 204);
      assert.equal(r.headers.get('access-control-allow-origin'), site);
    });
  }
  await check('foreign-origin rejected', '/checkout', {
    method: 'OPTIONS', headers: { Origin: 'https://invalid.example' },
  }, r => {
    status(r, 403);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  });
  await check('admin protected by Access', '/admin/export', {}, r => {
    status(r, 302);
    const redirect = new URL(r.headers.get('location'));
    assert.equal(redirect.protocol, 'https:');
    assert.equal(redirect.hostname, 'jamisonsoftware.cloudflareaccess.com');
    assert.equal(redirect.pathname, '/cdn-cgi/access/login/api.matthewjamison.dev');
  });
  await check('public audio range', '/s/beat-tape-1/01', {
    headers: { Range: 'bytes=0-31', Origin: site },
  }, async r => {
    status(r, 206);
    assert.equal(r.headers.get('content-type'), 'audio/flac');
    assert.match(r.headers.get('content-range') ?? '', /^bytes 0-31\/[1-9]\d*$/);
    assert.equal(r.headers.get('content-length'), '32');
    assert.equal(r.headers.get('access-control-allow-origin'), site);
    assert.equal((await r.arrayBuffer()).byteLength, 32);
  });
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smokeReadonly().then(results => {
    for (const result of results) console.log(`PASS ${result.name}: ${result.status}`);
  }).catch(error => {
    console.error(`Read-only production smoke failed: ${error.message}`);
    process.exitCode = 1;
  });
}
