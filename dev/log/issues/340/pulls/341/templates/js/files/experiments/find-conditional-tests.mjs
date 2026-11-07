#!/usr/bin/env node
// Lists every place a test file decides at registration time whether a test
// exists: an `if (...)` block that wraps `it(`/`describe(` calls, or a
// describe callback that `return`s early. Either way the runtime never hears
// about the test, so it is neither run nor reported as skipped.
// Usage: node experiments/find-conditional-tests.mjs [tests/*.test.js]
import { readdirSync, readFileSync } from 'node:fs';
import { findConditionalRegistrations } from '../tests/helpers/conditional-registration.js';

const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync('tests')
        .filter((file) => file.endsWith('.test.js'))
        .map((file) => `tests/${file}`);

let total = 0;
for (const file of files) {
  for (const finding of findConditionalRegistrations(
    readFileSync(file, 'utf8')
  )) {
    total += 1;
    console.log(`${file}:${finding.line}\t${finding.kind}\t${finding.text}`);
  }
}
console.log(`${total} conditional registration(s)`);
