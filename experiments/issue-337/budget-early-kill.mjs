#!/usr/bin/env node
// Reproduces issue #337: run-with-budget-warning.sh terminating a command
// that finishes inside its budget.
//
// bash's SECONDS counts wall-clock second boundaries crossed since it was
// set, not elapsed time, so it can read N while only N-1+epsilon seconds
// have passed. `[ "$SECONDS" -ge "$budget" ]` therefore fires up to a whole
// second early. Aligning the start just before a second boundary makes the
// early kill deterministic instead of the occasional macOS CI failure.
//
// Usage: node budget-early-kill.mjs [script] [budget] [commandSeconds] [poll] [fraction]
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script =
  process.argv[2] ??
  path.join(here, '..', '..', 'scripts', 'run-with-budget-warning.sh');
const budget = process.argv[3] ?? '2';
const commandSeconds = process.argv[4] ?? '1.4';
const poll = process.argv[5] ?? '0.1';
const fraction = Number(process.argv[6] ?? '0.75');

// Busy-wait until the wall clock is `fraction` of the way through a second.
while (
  Date.now() % 1000 < fraction * 1000 ||
  Date.now() % 1000 > fraction * 1000 + 30
) {}

const started = Date.now();
const result = spawnSync(
  'bash',
  [script, budget, 'aligned step', 'sleep', commandSeconds],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      BUDGET_POLL_SECONDS: poll,
      BUDGET_GRACE_SECONDS: '1',
    },
  }
);
const elapsed = (Date.now() - started) / 1000;

console.log(`start fraction ${(started % 1000) / 1000}`);
console.log(`budget ${budget}s, command ${commandSeconds}s, poll ${poll}s`);
console.log(`exit status ${result.status} after ${elapsed.toFixed(2)}s`);
console.log((result.stdout + result.stderr).trim());
console.log(
  result.status === 0
    ? 'OK: the command finished inside its budget and was not terminated'
    : 'BUG: a command shorter than its budget was terminated'
);
process.exitCode = result.status === 0 ? 0 : 1;
