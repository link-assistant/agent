import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'test-anywhere';
import { parse } from 'yaml';
import { checkSelfRepositoryPolicy } from '../scripts/check-ci-workflows.mjs';

const read = (path) => readFileSync(path, 'utf8');
const release = parse(read('.github/workflows/release.yml'));

describe('issue 287 workflow coverage', () => {
  for (const job of ['test-compilation', 'check-file-line-limits']) {
    it(`runs ${job} on manual dispatch with skipped change detection`, () => {
      const condition = release.jobs[job].if;
      assert.match(condition, /!cancelled\(\)/);
      assert.match(condition, /github.event_name == 'workflow_dispatch'/);
      // Evaluate the actual expression with the skipped dependency's empty outputs.
      const evaluate = (event, cancelled, outputs) => {
        const expression = condition
          .replaceAll('!cancelled()', String(!cancelled))
          .replaceAll('github.event_name', JSON.stringify(event))
          .replace(/needs.detect-changes.outputs.([\w-]+)/g, (_, name) =>
            JSON.stringify(outputs[name] || '')
          );
        assert.match(expression, /^[\s\w"'()=!&|.-]+$/);
        return Function(`return (${expression});`)();
      };
      assert.equal(evaluate('workflow_dispatch', false, {}), true);
      assert.equal(evaluate('workflow_dispatch', true, {}), false);
      assert.equal(evaluate('pull_request', false, {}), false);
      assert.equal(
        evaluate('pull_request', false, {
          'js-changed': 'true',
          'any-code-changed': 'true',
        }),
        true
      );
    });
  }
  it('keeps scorecards informational and vulnerabilities enforced', () => {
    const workflow = parse(read('.github/workflows/security.yml'));
    const step = workflow.jobs['dependency-review'].steps.find((s) =>
      s.uses?.startsWith('actions/dependency-review-action@')
    );
    assert.equal(step.with['show-openssf-scorecard'], true);
    assert.equal(step.with['warn-on-openssf-scorecard-level'], 0);
    assert.equal(step.with['fail-on-severity'], 'high');
  });
  it('lists all self-repository consumers in the narrow compatibility exception', () => {
    const files = {};
    const walk = (dir) => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        if (item.name === 'node_modules') {
          continue;
        }
        const path = join(dir, item.name);
        if (item.isDirectory()) {
          walk(path);
        } else if (/\.ya?ml$/.test(path)) {
          files[path] = read(path);
        }
      }
    };
    walk('.github/workflows');
    walk('.github/actions');
    const config = read('.github/zizmor.yml');
    assert.deepEqual(checkSelfRepositoryPolicy(files, config), []);
    const windowsFiles = Object.fromEntries(
      Object.entries(files).map(([path, content]) => [
        path.replaceAll('/', '\\'),
        content,
      ])
    );
    assert.deepEqual(
      checkSelfRepositoryPolicy(windowsFiles, config.replace(/\r?\n/g, '\r\n')),
      []
    );
    assert.deepEqual(checkSelfRepositoryPolicy({}, ''), []);
    assert.ok(checkSelfRepositoryPolicy(files, '').length);
    assert.ok(
      checkSelfRepositoryPolicy(
        {
          ...files,
          '.github/workflows/new.yml':
            'steps:\n - uses: ./.github/actions/artifact-transport',
        },
        config
      ).some((error) => error.includes('new.yml'))
    );
    assert.ok(
      checkSelfRepositoryPolicy(files, `${config}      - "*.yml"\n`).length
    );
  });
  for (const root of [
    '.',
    'examples/universal-app',
    '.github/actions/artifact-transport',
  ]) {
    it(`replaces vulnerable modern dependency ranges in ${root} while keeping legacy APIs`, () => {
      const { packages } = JSON.parse(read(`${root}/package-lock.json`));
      for (const [path, entry] of Object.entries(packages)) {
        const name = path.split('node_modules/').at(-1);
        const [major, minor, patch] = (entry.version || '')
          .split('.')
          .map(Number);
        if (name === 'minimatch') {
          assert.ok(
            major < 7 ||
              major > 11 ||
              (major === 11 && (minor > 0 || patch >= 4)),
            `${path}@${entry.version}`
          );
        }
        if (name === 'glob') {
          assert.ok(
            major < 9 ||
              major > 14 ||
              (major === 14 && (minor > 0 || patch >= 2)),
            `${path}@${entry.version}`
          );
        }
      }
    });
  }
});
