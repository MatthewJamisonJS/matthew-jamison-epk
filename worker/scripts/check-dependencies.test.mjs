import test from 'node:test';
import assert from 'node:assert/strict';
import { floors, scanLockfile } from './check-dependencies.mjs';
const fixture = () => ({ lockfileVersion: 3, packages: {
  '': { name: 'guard-fixture', version: '1.0.0' },
  ...Object.fromEntries(Object.entries(floors).map(([name, version]) => [`node_modules/${name}`, { version }])),
} });
test('accepts all secure floors', () => {
  const result = scanLockfile(fixture());
  assert.deepEqual(result.errors, []);
  assert.equal(result.checked, Object.keys(floors).length);
});
for (const name of Object.keys(floors)) test(`rejects vulnerable ${name}`, () => {
  const lock = fixture();
  lock.packages[`node_modules/${name}`].version = '0.0.0';
  assert.equal(scanLockfile(lock).errors.length, 1);
});
test('checks nested copies even when root copy is patched', () => {
  const lock = fixture();
  lock.packages['node_modules/wrangler/node_modules/undici'] = { version: '7.24.8' };
  assert.match(scanLockfile(lock).errors.join('\n'), /wrangler\/node_modules\/undici/);
});
for (const platform of ['darwin-64', 'darwin-arm64', 'linux-64', 'linux-arm64', 'windows-64']) {
  test(`checks optional workerd ${platform}`, () => {
    const lock = fixture();
    const path = `node_modules/@cloudflare/workerd-${platform}`;
    lock.packages[path] = { version: '1.20260815.1', optional: true };
    assert.equal(scanLockfile(lock).errors.length, 1);
    lock.packages[path].version = floors.workerd;
    assert.deepEqual(scanLockfile(lock).errors, []);
  });
}
test('accepts newer stable versions', () => {
  const lock = fixture();
  lock.packages['node_modules/ws'].version = '8.22.2';
  assert.deepEqual(scanLockfile(lock).errors, []);
});
test('rejects prereleases and invalid or absent versions', () => {
  for (const version of [undefined, null, 8, '', '8.21', '08.21.0', '8.21.0-rc.1', '9.0.0-beta']) {
    const lock = fixture();
    lock.packages['node_modules/ws'] = { version };
    assert.equal(scanLockfile(lock).errors.length, 1, String(version));
  }
});
test('fails closed on malformed lockfiles', () => {
  for (const lock of [null, [], {}, { lockfileVersion: 2, packages: { '': {} } }, { lockfileVersion: 3 }, { lockfileVersion: 3, packages: [] }, { lockfileVersion: 3, packages: {} }]) assert.ok(scanLockfile(lock).errors.length);
  const lock = fixture();
  lock.packages['node_modules/ws'] = null;
  assert.ok(scanLockfile(lock).errors.length);
});
test('allows removal of a dependency', () => {
  const lock = fixture();
  delete lock.packages['node_modules/ws'];
  assert.deepEqual(scanLockfile(lock).errors, []);
});

for (const [name, rejected, accepted] of [
  ['vite', ['8.2.3', '8.3.0', '8.3.1', '8.3.2', '8.4.0', '9.0.0'], ['8.2.4', '8.3.3', '8.3.8']],
  ['@vitest/mocker', ['4.1.11', '5.0.0', '5.0.1', '5.0.2', '6.0.0'], ['4.1.12', '5.0.3']],
  ['undici', ['7.30.0', '8.0.0', '8.12.0', '8.12.1', '9.0.0'], ['7.30.1', '8.12.2']],
]) {
  for (const version of rejected) test(`rejects unpatched or unreviewed ${name} ${version}`, () => {
    const lock = fixture();
    lock.packages[`node_modules/${name}`].version = version;
    assert.equal(scanLockfile(lock).errors.length, 1);
  });
  for (const version of accepted) test(`accepts reviewed ${name} ${version}`, () => {
    const lock = fixture();
    lock.packages[`node_modules/${name}`].version = version;
    assert.deepEqual(scanLockfile(lock).errors, []);
  });
}
for (const [name, version] of [
  ['ws', '9.0.0'], ['qs', '7.0.0'], ['zod', '5.0.0'],
  ['source-map-js', '2.0.0'], ['workerd', '2.20261110.1'],
  ['@cloudflare/workerd-linux-64', '2.20261110.1'],
  ['sharp', '0.36.0'], ['sharp', '1.0.0'], ['esbuild', '0.29.0'], ['esbuild', '1.0.0'],
  ['vite', '8.3.3-rc.1'], ['undici', '8.12.2-beta'], ['@vitest/mocker', '5.0.3+unreviewed'],
]) test(`fails closed for ${name} ${version}`, () => {
  const lock = fixture();
  lock.packages[`node_modules/${name}`] = { version };
  assert.equal(scanLockfile(lock).errors.length, 1);
});
