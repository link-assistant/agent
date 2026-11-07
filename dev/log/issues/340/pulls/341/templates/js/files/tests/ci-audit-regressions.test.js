import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'test-anywhere';
import { itUnless, noPosixShell, sandboxed } from './helpers/skip.js';

// Windows checkouts may convert tracked text to CRLF.
const readText = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');

const roots = [
  '.',
  'examples/universal-app',
  '.github/actions/artifact-transport',
];

describe('CI audit regressions', () => {
  for (const root of roots) {
    it(`records a decision for every dependency install script in ${root}`, () => {
      const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
      const lock = JSON.parse(
        readFileSync(`${root}/package-lock.json`, 'utf8')
      );
      for (const [path, dependency] of Object.entries(lock.packages)) {
        if (!dependency.hasInstallScript) {
          continue;
        }
        const name = path.split('node_modules/').at(-1);
        const policy = manifest.allowScripts || {};
        assert.ok(
          policy[name] === false ||
            policy[`${name}@${dependency.version}`] === true,
          `${root}: review and pin ${name}@${dependency.version}`
        );
      }
    });
  }

  it('records Deno decisions separately from npm install-script decisions', () => {
    const { allowScripts } = JSON.parse(readFileSync('deno.json', 'utf8'));
    const { packages } = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    const npmPolicy = JSON.parse(
      readFileSync('package.json', 'utf8')
    ).allowScripts;
    for (const [path, dependency] of Object.entries(packages)) {
      if (!dependency.hasInstallScript) {
        continue;
      }
      const name = path.split('node_modules/').at(-1);
      const decision = npmPolicy[name] === false ? 'deny' : 'allow';
      assert.ok(
        allowScripts?.[decision]?.includes(`npm:${name}@${dependency.version}`),
        `Deno must independently ${decision} ${name}@${dependency.version}`
      );
    }
  });

  it('includes shipped applications in CodeQL analysis', () => {
    const config = readText('.github/codeql/codeql-config.yml');
    assert.doesNotMatch(config, /^\s*-\s*examples\s*$/m);
    assert.doesNotMatch(config, /^\s*-\s*examples\//m);
  });

  it('keeps Pages deployment permissions and preconditions', () => {
    const workflow = readText('.github/workflows/example-app.yml');
    const job = workflow
      .split('\n  pages-deploy:')[1]
      .split('\n  desktop-package:')[0];
    assert.match(
      job,
      /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/
    );
    assert.match(job, /needs: \[web-build\]/);
    assert.match(
      job,
      /permissions:\n(?:\s+#[^\n]*\n)*\s+contents: read\n\s+pages: write\n\s+id-token: write\n\s+environment:/
    );
    assert.match(job, /name: github-pages/);
    assert.match(
      job,
      /run: node --throw-deprecation scripts\/deploy-pages\.mjs/
    );
    assert.match(job, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(
      job,
      /ARTIFACT_ID: \$\{\{ needs\.web-build\.outputs\.pages-artifact-id \}\}/
    );
    assert.match(
      workflow,
      /pages-artifact-id: \$\{\{ steps\.pages-artifact\.outputs\.artifact-id \}\}/
    );
    assert.match(workflow, /id: pages-artifact\n/);
    assert.doesNotMatch(
      job,
      /--disable-warning|--no-warnings|NODE_NO_WARNINGS/
    );
  });

  it('installs artifact dependencies without deprecated packages', () => {
    const lock = JSON.parse(
      readFileSync(
        '.github/actions/artifact-transport/package-lock.json',
        'utf8'
      )
    );
    assert.deepEqual(
      Object.entries(lock.packages)
        .filter(([, entry]) => entry.deprecated)
        .map(([path]) => path),
      []
    );
  });

  for (const files of [
    { 'src/index.js': 'const broken = ;' },
    { 'scripts/nested/adapter.cjs': 'module.exports = ;' },
    { 'tests/nested/check.mjs': 'export const broken = ;' },
    {},
  ]) {
    itUnless(sandboxed || noPosixShell)(
      `syntax gate rejects incomplete evidence: ${Object.keys(files).join(', ') || 'empty repository'}`,
      () => {
        const root = mkdtempSync(join(tmpdir(), 'ci-syntax-'));
        try {
          assert.equal(
            spawnSync('git', ['init', '-q'], { cwd: root }).status,
            0
          );
          for (const [file, source] of Object.entries(files)) {
            mkdirSync(dirname(join(root, file)), { recursive: true });
            writeFileSync(join(root, file), source);
          }
          assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0);
          const result = spawnSync(
            'bash',
            [resolve('scripts/check-mjs-syntax.sh')],
            { cwd: root, encoding: 'utf8' }
          );
          assert.notEqual(result.status, 0, result.stdout + result.stderr);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }
    );
  }

  itUnless(sandboxed || noPosixShell)(
    'syntax gate accepts valid nested shipped code',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'ci-syntax-valid-'));
      try {
        assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
        mkdirSync(join(root, 'examples/app/src'), { recursive: true });
        writeFileSync(
          join(root, 'examples/app/src/index.mjs'),
          'export const ready = true;'
        );
        assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0);
        const result = spawnSync(
          'bash',
          [resolve('scripts/check-mjs-syntax.sh')],
          { cwd: root, encoding: 'utf8' }
        );
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /1 file\(s\), 0 failure\(s\)/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});
