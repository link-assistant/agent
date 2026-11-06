import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = new URL('./check-codeql-results.mjs', import.meta.url);
const run = (results = []) => ({ tool: { driver: { name: 'CodeQL' } },
  invocations: [{ executionSuccessful: true }], results });
const sarif = (...runs) => ({ version: '2.1.0', runs });

test('SARIF gate rejects missing/invalid reports and checks every file/run/severity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codeql-results-'));
  const check = (expected) => {
    const result = spawnSync(process.execPath, [cli.pathname, dir], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status === 0, expected, result.stdout + result.stderr);
    return result;
  };
  const write = (value, name = 'rust.sarif') => writeFileSync(join(dir, name),
    typeof value === 'string' ? value : JSON.stringify(value));
  try {
    check(false);
    for (const invalid of ['{', {}, sarif(), sarif({}), sarif({ ...run(), results: null }),
      sarif({ ...run(), invocations: [{ executionSuccessful: false }] }),
      sarif({ ...run(), invocations: [] }), sarif({ ...run(), results: [null] })]) {
      write(invalid); check(false);
    }
    write(sarif(run())); check(true);
    for (const level of ['error', 'warning', 'note', 'none', undefined]) {
      const finding = { ruleId: 'test/rule', message: { text: 'unresolved' }, level };
      write(sarif(run(), run([finding])));
      assert.match(check(false).stderr, /test\/rule/);
      write(sarif(run([{ ...finding, suppressions: [{ kind: 'inSource' }] }]))); check(false);
      write(sarif(run([{ ...finding, baselineState: 'absent' }]))); check(true);
    }
    write(sarif(run()));
    mkdirSync(join(dir, 'nested'));
    write(sarif(run([{ ruleId: 'test/second', message: { text: 'second file' } }])), 'nested/actions.sarif');
    check(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SARIF invocation diagnostics gate extraction even with no findings', { timeout: 20000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'codeql-notifications-'));
  try {
    const check = (invocations) => {
      writeFileSync(join(dir, 'analysis.sarif'), JSON.stringify(sarif({ ...run(), invocations })));
      return spawnSync(process.execPath, [cli.pathname, dir], { encoding: 'utf8', timeout: 5000 });
    };
    for (const field of ['toolExecutionNotifications', 'toolConfigurationNotifications']) {
      const diagnostic = { descriptor: { id: 'extract/failure' }, message: { text: 'Extraction failed' },
        locations: [{ physicalLocation: { artifactLocation: { uri: 'src/lib.rs' }, region: { startLine: 42 } } }] };
      for (const level of ['error', 'warning', undefined]) {
        const result = check([{ executionSuccessful: true },
          { executionSuccessful: true, [field]: [{ ...diagnostic, level }] }]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /extract\/failure/);
        assert.match(result.stderr, /src\/lib.rs:42/);
        assert.match(result.stderr, /Extraction failed/);
      }
      for (const value of [null, {}, 'invalid', [null], [1], [{}], [{ level: 'note' }],
        [{ message: { text: 'bad level' }, level: 'unknown' }],
        [{ message: 'invalid' }], [{ message: { text: 12 } }], [{ message: { text: 'null level' }, level: null }]]) {
        const result = check([{ executionSuccessful: true, [field]: value }]);
        assert.equal(result.status, 1, JSON.stringify(value));
        assert.match(result.stderr, /Malformed SARIF notification/);
      }
      for (const level of ['note', 'none']) {
        const result = check([{ executionSuccessful: true, [field]: [{ ...diagnostic, level }] }]);
        assert.equal(result.status, 0, result.stderr);
      }
      assert.equal(check([{ executionSuccessful: true, [field]: [] }]).status, 0);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
