// Offline, bounded comparison with the issue's immutable template snapshot.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const before = process.argv.includes('--before');
const baseline = '7877a27980664bc6453e80262f8391d1c2562ab1';
const temp = mkdtempSync(join(tmpdir(), 'issue-287-repro-'));
try {
  cpSync('scripts', join(temp, 'scripts'), { recursive: true });
  writeFileSync(join(temp, 'package.json'), '{"type":"module"}');
  if (before) {
    for (const name of [
      'push-main-with-rebase-retry',
      'push-failure-classifier',
      'npm-audit-report',
      'recheck-broken-links',
      'check-codeql-results',
    ]) {
      writeFileSync(
        join(temp, 'scripts', `${name}.mjs`),
        execFileSync('git', ['show', `${baseline}:scripts/${name}.mjs`], {
          timeout: 5000,
        })
      );
    }
  }
  const load = (name) =>
    import(pathToFileURL(resolve(temp, 'scripts', `${name}.mjs`)).href);
  const { pushWithRecovery } = await load('push-main-with-rebase-retry');
  let attempts = 0;
  let recovered = false;
  try {
    await pushWithRecovery({
      runner: () =>
        Promise.resolve(
          ++attempts === 1
            ? { code: 1, stderr: 'remote: fatal error in commit_refs_rules' }
            : { code: 0 }
        ),
      sleepFn: async () => {},
      logger: { log() {} },
    });
    recovered = true;
  } catch {
    /* the old implementation fails at the first push */
  }
  assert.equal(recovered, !before);
  assert.equal(attempts, before ? 1 : 2);
  console.log(
    `push retry: ${before ? 'reproduced immediate failure' : 'recovered unchanged push'}`
  );

  const { main } = await load('npm-audit-report');
  let status;
  const originalLog = console.log;
  try {
    console.log = () => {};
    status = main({}, () => ({ status: 2, stdout: '{"vulnerabilities":{}}' }));
  } finally {
    console.log = originalLog;
  }
  assert.equal(status, before ? 0 : 1);
  console.log(
    `audit transport: ${before ? 'reproduced false pass' : 'rejected failed execution'}`
  );

  const { parseLycheeFailures } = await load('recheck-broken-links');
  const failures = parseLycheeFailures(
    '## Errors per input\n* [404] https://example.com/missing\n* [ERROR] https://example.com/reset\n'
  );
  assert.equal(failures.length, before ? 1 : 2);
  console.log(`lychee adjacent errors: ${failures.length} records`);

  const { checkCodeqlResults } = await load('check-codeql-results');
  const directory = join(temp, 'sarif');
  mkdirSync(directory);
  writeFileSync(
    join(directory, 'example.sarif'),
    JSON.stringify({
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'CodeQL' } },
          results: [],
          invocations: [
            {
              executionSuccessful: true,
              toolExecutionNotifications: [
                { level: 'error', message: { text: 'Extraction failed' } },
              ],
            },
          ],
        },
      ],
    })
  );
  let rejected = false;
  try {
    checkCodeqlResults(directory, () => {});
  } catch {
    rejected = true;
  }
  assert.equal(rejected, !before);
  console.log(
    `CodeQL extraction: ${before ? 'reproduced false pass' : 'rejected extraction diagnostic'}`
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
