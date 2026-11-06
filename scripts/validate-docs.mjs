#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', '-z', '*.md'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)
  .filter(
    (file) =>
      !/^(dev\/log\/|docs\/case-studies\/|js\/docs\/case-studies\/)/.test(file)
  );
let failures = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (text.split('\n').length > 2500) {
    console.error(`::error file=${file}::Documentation exceeds 2500 lines`);
    failures++;
  }
}
for (const file of [
  'README.md',
  'js/README.md',
  'rust/README.md',
  'TESTING.md',
]) {
  if (!/^#\s+\S/m.test(readFileSync(file, 'utf8'))) {
    console.error(`::error file=${file}::Missing document title`);
    failures++;
  }
}
console.log(`Validated ${files.length} documentation files.`);
process.exitCode = failures ? 1 : 0;
