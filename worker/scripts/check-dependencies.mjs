import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression floors for the November 2026 findings, not a substitute for
// current npm/Semgrep advisories. qs uses a verified safe target, not a claim
// about the earliest patched release. workerd's exact tag bundles Brotli 1.2.1.
export const floors = Object.freeze({
  ws: '8.21.0', undici: '7.30.1', qs: '6.17.1', vite: '8.2.4',
  '@vitest/mocker': '4.1.12', esbuild: '0.28.1', sharp: '0.35.5',
  'source-map-js': '1.2.2', zod: '4.6.6', workerd: '1.20261110.1',
});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function meetsFloor(version, minimum) {
  // Reject prereleases and malformed versions conservatively.
  if (typeof version !== 'string' || !stable.test(version)) return false;
  const actual = version.split('.').map(BigInt);
  const required = minimum.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (actual[i] > required[i]) return true;
    if (actual[i] < required[i]) return false;
  }
  return true;
}
// Security fixes are release-line specific, not monotonic across major/minor
// upgrades. Unknown release lines fail closed until their advisories are reviewed.
export function isReviewedVersion(name, version) {
  if (typeof version !== 'string' || !stable.test(version)) return false;
  const [major, minor] = version.split('.');
  if (name === 'vite') {
    if (major !== '8') return false;
    return minor === '2' ? meetsFloor(version, '8.2.4')
      : minor === '3' && meetsFloor(version, '8.3.3');
  }
  if (name === '@vitest/mocker') {
    return major === '4' ? meetsFloor(version, '4.1.12')
      : major === '5' && meetsFloor(version, '5.0.3');
  }
  if (name === 'undici') {
    return major === '7' ? meetsFloor(version, '7.30.1')
      : major === '8' && meetsFloor(version, '8.12.2');
  }
  const minimum = name.startsWith('@cloudflare/workerd-') ? floors.workerd
    : Object.hasOwn(floors, name) ? floors[name] : undefined;
  if (!minimum) return false;
  const [requiredMajor, requiredMinor] = minimum.split('.');
  return major === requiredMajor &&
    (major !== '0' || minor === requiredMinor) && meetsFloor(version, minimum);
}
export function scanLockfile(lock) {
  const errors = [];
  let checked = 0;
  if (!object(lock) || lock.lockfileVersion !== 3 || !object(lock.packages) || !object(lock.packages[''])) {
    return { checked, errors: ['Expected npm lockfile v3 with a packages map and root entry.'] };
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!object(entry)) {
      errors.push(`${path || '<root>'}: invalid package entry`);
      continue;
    }
    if (path === '') continue;
    const name = path.split('node_modules/').at(-1);
    const minimum = name.startsWith('@cloudflare/workerd-') ? floors.workerd : Object.hasOwn(floors, name) ? floors[name] : undefined;
    if (!minimum) continue;
    checked++;
    if (!isReviewedVersion(name, entry.version)) {
      errors.push(`${path}: ${String(entry.version)} is outside the reviewed secure release lines (baseline ${minimum})`);
    }
  }
  return { checked, errors };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const path = process.argv[2] ?? fileURLToPath(new URL('../package-lock.json', import.meta.url));
    const { checked, errors } = scanLockfile(JSON.parse(readFileSync(path, 'utf8')));
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
    } else console.log(`Dependency regression guard passed: ${checked} package copies checked.`);
  } catch (error) {
    console.error(`Dependency regression guard failed: ${error.message}`);
    process.exitCode = 1;
  }
}
