import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import * as native from './native.mjs';

assert.ok(process.argv.includes('--strict'), 'Strict readiness is required');
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const { features } = read('./inventory.json');
assert.deepEqual(
  features.map(({ id }) => id).sort(),
  Object.keys(native).sort(),
  'Every public feature must appear exactly once in the inventory'
);
for (const feature of features) {
  assert.equal(
    feature.status,
    'complete',
    `${feature.id} is ${feature.status}`
  );
  assert.equal(
    feature.nativeAdapter,
    false,
    'Carried native code is not supported by this example'
  );
  assert.equal(feature.evidence, 'cases.json');
  const cases = read(`./${feature.evidence}`);
  assert.ok(
    cases.length >= 7,
    'Boundary and refusal evidence must be retained'
  );
  for (const [input, expected] of cases) {
    assert.equal(native[feature.id](input), expected);
  }
}
console.log('Complete native feature inventory and shared observations passed');
