import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { isEven } from './native.mjs';

test('signed integer parity, including both boundaries', () => {
  const cases = JSON.parse(
    readFileSync(new URL('./cases.json', import.meta.url))
  );
  for (const [input, expected] of cases) {
    assert.equal(isEven(input), expected);
  }
  for (const input of [NaN, Infinity, 0.5, '2', -2147483649, 2147483648]) {
    assert.throws(() => isEven(input), RangeError);
  }
});
