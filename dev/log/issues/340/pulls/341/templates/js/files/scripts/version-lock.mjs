import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}
function nonVersionManifest(pkg) {
  const result = globalThis.structuredClone(pkg);
  delete result.version;
  return result;
}
function nonVersionLock(lock) {
  const result = globalThis.structuredClone(lock);
  delete result.version;
  delete result.packages[''].version;
  return result;
}
export function captureVersionTree(jsRoot) {
  const manifest = readJson(join(jsRoot, 'package.json'));
  const lock = readJson(join(jsRoot, 'package-lock.json'));
  validateVersionTree({ manifest, lock });
  return { manifest, lock };
}
export function validateVersionTree({ manifest, lock }) {
  if (
    ![2, 3].includes(lock.lockfileVersion) ||
    !lock.packages?.[''] ||
    typeof manifest.name !== 'string' ||
    !manifest.name ||
    lock.name !== manifest.name ||
    lock.packages[''].name !== manifest.name ||
    typeof manifest.version !== 'string' ||
    lock.version !== manifest.version ||
    lock.packages[''].version !== manifest.version
  ) {
    throw new Error(
      'Invalid package/lock names, root record, version, or unsupported lockfile (requires npm v2/v3)'
    );
  }
}
/** Versioning may change only the manifest version and two root lock versions. */
export function assertVersionOnlyChanges(before, { manifest, lock }) {
  assert.deepEqual(
    nonVersionManifest(manifest),
    nonVersionManifest(before.manifest),
    'Package configuration changed after validation: package.json'
  );
  assert.deepEqual(
    nonVersionLock(lock),
    nonVersionLock(before.lock),
    'Package configuration changed after validation: package-lock.json'
  );
}
export function syncVersionLock(jsRoot, before) {
  const manifest = readJson(join(jsRoot, 'package.json'));
  const lock = readJson(join(jsRoot, 'package-lock.json'));
  assertVersionOnlyChanges(before, { manifest, lock });
  if (
    typeof manifest.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(manifest.version)
  ) {
    throw new Error('Invalid release version');
  }
  lock.version = manifest.version;
  lock.packages[''].version = manifest.version;
  writeFileSync(
    join(jsRoot, 'package-lock.json'),
    `${JSON.stringify(lock, null, 2)}\n`
  );
  captureVersionTree(jsRoot);
}
