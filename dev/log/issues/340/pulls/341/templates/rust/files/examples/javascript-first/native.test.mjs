import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { add } from './native.mjs';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)));
for (const fixture of fixtures) {
  test(fixture.feature, () => {
    if (fixture.error) assert.throws(() => add(...fixture.args), { name: 'RangeError', message: fixture.error });
    else assert.equal(add(...fixture.args), fixture.result);
  });
}
