import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'test-anywhere';
import { itUnless, sandboxed } from './helpers/skip.js';

const report = (results = []) => ({
  version: '2.1.0',
  runs: [
    {
      tool: { driver: { name: 'CodeQL' } },
      invocations: [{ executionSuccessful: true }],
      results,
    },
  ],
});
function check(reports) {
  const root = mkdtempSync(join(tmpdir(), 'sarif-gate-'));
  try {
    for (const [index, data] of reports.entries()) {
      writeFileSync(
        join(root, `${index}.sarif`),
        typeof data === 'string' ? data : JSON.stringify(data)
      );
    }
    return spawnSync(
      'node',
      [resolve('scripts/check-codeql-results.mjs'), root],
      { encoding: 'utf8' }
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
describe('CodeQL local result gate', () => {
  itUnless(sandboxed)(
    'accepts explicit clean reports from every language',
    () => {
      const result = check([report(), report()]);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
  );
  for (const data of [
    [],
    ['{'],
    [{}],
    [{ version: '2.1.0', runs: [] }],
    [{ version: '2.1.0', runs: [{}] }],
    [
      {
        version: '2.1.0',
        runs: [
          {
            ...report().runs[0],
            invocations: [{ executionSuccessful: false }],
          },
        ],
      },
    ],
  ]) {
    itUnless(sandboxed)(
      `rejects missing, malformed, or unsuccessful evidence ${JSON.stringify(data)}`,
      () => {
        assert.notEqual(check(data).status, 0);
      }
    );
  }
  for (const level of ['error', 'warning', 'note', 'none', undefined]) {
    itUnless(sandboxed)(
      `rejects a finding with severity ${level} in a later run/file`,
      () => {
        const data = report();
        data.runs.push(
          report([
            {
              ruleId: 'test/finding',
              level,
              message: { text: 'regression finding' },
            },
          ]).runs[0]
        );
        const result = check([report(), data]);
        assert.notEqual(result.status, 0);
        assert.match(result.stdout + result.stderr, /test\/finding/);
      }
    );
  }
  it('makes full analysis and the strict result gate prerequisites of terminal success', () => {
    const workflow = readFileSync('.github/workflows/security.yml', 'utf8');
    assert.match(workflow, /CODEQL_ACTION_DIFF_INFORMED_QUERIES: 'false'/);
    assert.match(workflow, /output: codeql-results/);
    assert.ok(
      workflow.indexOf('scripts/check-codeql-results.mjs') >
        workflow.indexOf('github/codeql-action/analyze@v4')
    );
    assert.match(workflow, /path: codeql-results/);
  });
});

describe('CodeQL extraction diagnostics', () => {
  for (const key of [
    'toolExecutionNotifications',
    'toolConfigurationNotifications',
  ]) {
    for (const level of ['error', 'warning', undefined, 'note', 'none']) {
      itUnless(sandboxed)(
        `${key} enforces ${level ?? 'default warning'} even without findings`,
        () => {
          const data = report();
          data.runs[0].invocations[0][key] = [
            {
              level,
              descriptor: { id: 'extractor/failure' },
              message: { text: 'Extraction diagnostic' },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: 'src/example.js' },
                    region: { startLine: 42 },
                  },
                },
              ],
            },
          ];
          const result = check([data]);
          assert.equal(
            result.status,
            ['note', 'none'].includes(level) ? 0 : 1,
            result.stderr
          );
          if (result.status) {
            for (const text of [
              'extractor/failure',
              'src/example.js:42',
              'Extraction diagnostic',
            ]) {
              assert.ok(result.stderr.includes(text), result.stderr);
            }
          }
        }
      );
    }
    itUnless(sandboxed)(
      `${key} accepts CodeQL's empty success diagnostic`,
      () => {
        const data = report();
        data.runs[0].invocations[0][key] = [
          {
            level: 'none',
            descriptor: { id: 'js/diagnostics/successfully-extracted-files' },
            message: { text: '' },
            locations: [
              {
                physicalLocation: { artifactLocation: { uri: 'src/index.js' } },
              },
            ],
          },
        ];
        const result = check([data]);
        assert.equal(result.status, 0, result.stderr);
      }
    );
    for (const value of [
      null,
      {},
      'broken',
      [null],
      [{}],
      [{ level: 'invalid', message: { text: 'bad' } }],
      [{ level: 'none' }],
    ]) {
      itUnless(sandboxed)(
        `${key} rejects malformed evidence ${JSON.stringify(value)}`,
        () => {
          const data = report();
          data.runs[0].invocations[0][key] = value;
          assert.notEqual(check([data]).status, 0);
        }
      );
    }
  }
});
