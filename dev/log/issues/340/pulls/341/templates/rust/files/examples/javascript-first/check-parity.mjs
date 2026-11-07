// Complete inventory for this opt-in example, not for the Rust-only root crate.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { add } from './native.mjs';
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const inventory = JSON.parse(read('./parity.json'));
const fixtures = JSON.parse(read('./fixtures.json'));
const expected = fixtures.map(f => f.feature).sort();
if (inventory.scope !== 'javascript-first-example' || inventory.api !== 'add' ||
    inventory.nativeAdapter !== 'Rust i32 types reject invalid input before invocation' ||
    inventory.features.length !== expected.length ||
    JSON.stringify(inventory.features.map(f => f.name).sort()) !== JSON.stringify(expected) ||
    inventory.features.some(f => f.status !== 'complete' || f.carried !== false)) {
  throw Error('Missing, partial, unsupported or carried parity entry');
}
for (const name of ['native.mjs', 'ir.json', 'generate.mjs', 'fixtures.json']) {
  if (inventory.hashes[name] !== createHash('sha256').update(read(`./${name}`)).digest('hex')) {
    throw Error(`Parity evidence is stale: ${name}`);
  }
}
for (const fixture of fixtures) {
  let result, error;
  try { result = add(...fixture.args); } catch (e) { error = e.message; }
  if (result !== fixture.result || error !== fixture.error) throw Error(`Native parity failed: ${fixture.feature}`);
}
console.log('Complete native readiness inventory; downstream Rust tests verify the shared observations.');
