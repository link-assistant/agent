import { describe, it, expect } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { itUnless, noPosixShell, sandboxed } from './helpers/skip.js';

const scriptPath = fileURLToPath(
  new URL('../scripts/simulate-fresh-merge.sh', import.meta.url)
);
const script = readFileSync(scriptPath, 'utf8');

// A stand-in `git` whose fetch behaviour the test controls through a
// counter file: the whole script runs hermetically, including its
// `git config`, `rev-parse` and `rev-list` calls.
function createFakeGit({ failFirstFetches }) {
  const root = mkdtempSync(path.join(tmpdir(), 'fresh-merge-'));
  const binPath = path.join(root, 'bin');
  const counterFile = path.join(root, 'fetch-attempts');

  mkdirSync(binPath, { recursive: true });
  writeFileSync(counterFile, '0');

  const gitPath = path.join(binPath, 'git');
  writeFileSync(
    gitPath,
    `#!/usr/bin/env bash
if [ "$1" = "fetch" ]; then
  n=$(( $(cat "$FETCH_COUNT_FILE" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$FETCH_COUNT_FILE"
  if [ "$n" -le "${failFirstFetches}" ]; then
    echo "fatal: unable to access 'https://github.com/o/r/': Could not resolve host: github.com" >&2
    exit 128
  fi
  exit 0
fi
case "$1" in
  config) exit 0 ;;
  rev-parse) echo 0000000000000000000000000000000000000000 ;;
  rev-list) echo 0 ;;
  *) exit 0 ;;
esac
`
  );
  chmodSync(gitPath, 0o755);

  return { root, binPath, counterFile };
}

function runFreshMerge(binPath, counterFile) {
  return spawnSync('bash', [scriptPath], {
    encoding: 'utf8',
    cwd: mkdtempSync(path.join(tmpdir(), 'fresh-merge-cwd-')),
    env: {
      ...process.env,
      PATH: `${binPath}${path.delimiter}${process.env.PATH ?? ''}`,
      BASE_REF: 'main',
      FETCH_COUNT_FILE: counterFile,
      FRESH_MERGE_RETRY_DELAY_SECONDS: '0',
    },
  });
}

describe('simulate-fresh-merge.sh', () => {
  it('quotes base ref arguments to prevent word splitting', () => {
    expect(script).toContain('git rev-list --count "HEAD..origin/$BASE_REF"');
    expect(script).toContain('git merge "origin/$BASE_REF" --no-edit');
    expect(script).not.toContain('git rev-list --count HEAD..origin/$BASE_REF');
    expect(script).not.toContain('git merge origin/$BASE_REF --no-edit');
  });

  it('retries the base fetch with a bounded loop', () => {
    expect(script).toContain('fetch_with_retry');
    expect(script).toContain('FRESH_MERGE_RETRY_DELAY_SECONDS');
    expect(script).toContain('::error::git fetch origin');
    expect(script).toContain('failed $max_attempts times');
  });
});

describe('simulate-fresh-merge.sh fetch retry', () => {
  itUnless(sandboxed, noPosixShell)(
    'survives a transient fetch failure',
    () => {
      const fake = createFakeGit({ failFirstFetches: 1 });

      try {
        const result = runFreshMerge(fake.binPath, fake.counterFile);

        expect(result.status).toBe(0);
        expect(result.stderr).toContain('attempt 1/5');
        expect(result.stdout).toContain('No simulation needed');
        expect(readFileSync(fake.counterFile, 'utf8').trim()).toBe('2');
      } finally {
        rmSync(fake.root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'still fails when the base branch cannot be fetched at all',
    () => {
      const fake = createFakeGit({ failFirstFetches: 99 });

      try {
        const result = runFreshMerge(fake.binPath, fake.counterFile);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('failed 5 times');
        expect(readFileSync(fake.counterFile, 'utf8').trim()).toBe('5');
      } finally {
        rmSync(fake.root, { recursive: true, force: true });
      }
    }
  );
});
