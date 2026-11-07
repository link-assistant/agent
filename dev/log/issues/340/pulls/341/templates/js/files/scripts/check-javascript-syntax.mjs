#!/usr/bin/env node

/**
 * Syntax-check every tracked JavaScript file (.js, .mjs, .cjs) recursively.
 *
 * Git discovery covers nested sources, tests, shipped examples and local
 * action adapters while skipping dependencies and ignored build output.
 * Historical investigation data is explicitly excluded: it mirrors external
 * sources verbatim and is not executed by this repository.
 *
 * An empty inventory is an error, so a broken discovery cannot pass as green.
 *
 * Usage: node scripts/check-javascript-syntax.mjs
 * Exit code 0 = every discovered file passed; 1 = a failure or no evidence.
 */

import { execFileSync, spawnSync } from 'node:child_process';

const EXCLUDED = /^(?:docs\/case-studies|dev\/log)\//;

let tracked;
try {
  tracked = execFileSync(
    'git',
    ['ls-files', '-z', '--', '*.js', '*.mjs', '*.cjs'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
} catch (error) {
  console.error(`::error::Syntax gate could not list files: ${error.message}`);
  process.exit(1);
}

const files = tracked
  .split('\0')
  .filter((file) => file && !EXCLUDED.test(file));

if (!files.length) {
  console.error('::error::Syntax gate found no tracked JavaScript files');
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  console.log(`Checking ${file}...`);
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit',
    timeout: 10000,
  });
  if (result.error || result.status !== 0) {
    const reason = result.error ? `: ${result.error.message}` : '';
    console.error(
      `::error file=${file}::JavaScript syntax check failed${reason}`
    );
    failures++;
  }
}
console.log(`Syntax check: ${files.length} file(s), ${failures} failure(s)`);
process.exitCode = failures ? 1 : 0;
