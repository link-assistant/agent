#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportFreshness } from './freshness-policy.mjs';

export function cargoFreshness(
  run = spawnSync,
  env = process.env,
  log = console.error
) {
  // Keep the drift exit code distinct from cargo/tool/network failures (1).
  const result = run(
    'cargo',
    ['outdated', '--root-deps-only', '--exit-code', '10'],
    { encoding: 'utf8' }
  );
  if (result.error || result.signal || ![0, 10].includes(result.status)) {
    throw (
      result.error ||
      new Error(
        `cargo outdated failed: ${result.signal || result.status}\n${result.stderr || ''}`
      )
    );
  }
  if (result.stdout) {
    log(result.stdout);
  }
  if (result.stderr) {
    log(result.stderr);
  }
  return result.status === 10
    ? reportFreshness(
        ['Update the direct Rust dependencies listed above.'],
        env,
        log
      )
    : 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exitCode = cargoFreshness();
}
