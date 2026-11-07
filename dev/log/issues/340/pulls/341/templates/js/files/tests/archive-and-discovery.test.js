import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe } from 'test-anywhere';
import { itUnless, sandboxed } from './helpers/skip.js';

describe('archive and test discovery boundaries', () => {
  for (const content of [
    null,
    '',
    'not a lychee report',
    '# Link Checker Report\n\n| Errors | broken |',
    'malformed report\n- [404] https://broken.example/recovered\n',
    '# Link Checker Report\n\n| Errors | 0 |\n- [404] https://broken.example/recovered\n',
    'unreadable-directory',
  ]) {
    itUnless(sandboxed)(
      `rejects unusable failed-checker evidence ${JSON.stringify(content)}`,
      () => {
        const cwd = mkdtempSync(join(tmpdir(), 'lychee-missing-'));
        try {
          const report = join(cwd, 'report.md');
          const output = join(cwd, 'outputs');
          const recovered = join(cwd, 'recovered.txt');
          writeFileSync(recovered, 'https://broken.example/recovered\n');
          if (content === 'unreadable-directory') {
            mkdirSync(report);
          } else if (content !== null) {
            writeFileSync(report, content);
          }
          const result = spawnSync(
            'node',
            [resolve('scripts/check-web-archive.mjs')],
            {
              encoding: 'utf8',
              env: {
                ...process.env,
                LYCHEE_OUTPUT: report,
                LYCHEE_EXIT_CODE: '2',
                RECOVERED_URLS: recovered,
                GITHUB_OUTPUT: output,
              },
            }
          );
          assert.notEqual(result.status, 0, result.stdout);
          assert.match(readFileSync(output, 'utf8'), /all_archived=false/);
          assert.doesNotMatch(
            readFileSync(output, 'utf8'),
            /all_archived=true/
          );
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }
    );
  }
  itUnless(sandboxed)(
    'pins the real hook arguments while keeping maintained source checked',
    () => {
      const cwd = mkdtempSync(join(tmpdir(), 'root-lint-staged-'));
      try {
        execFileSync('git', ['init', '-q'], { cwd });
        execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd });
        mkdirSync(join(cwd, 'dev/log/reference'), { recursive: true });
        mkdirSync(join(cwd, 'src'));
        writeFileSync(
          join(cwd, 'record.cjs'),
          "require('node:fs').writeFileSync('checked.json',JSON.stringify(process.argv.slice(2)))"
        );
        writeFileSync(
          join(cwd, 'package.json'),
          JSON.stringify({ 'lint-staged': { '*.js': 'node record.cjs' } })
        );
        writeFileSync(
          join(cwd, 'dev/log/reference/package.json'),
          JSON.stringify({
            'lint-staged': { '*.js': 'node -e "process.exit(42)"' },
          })
        );
        writeFileSync(
          join(cwd, 'dev/log/reference/sample.js'),
          '// archived fixture\n'
        );
        writeFileSync(join(cwd, 'src/maintained.js'), '// maintained\n');
        execFileSync('git', ['add', '.'], { cwd });
        const command = readFileSync('.husky/pre-commit', 'utf8')
          .split(/\r?\n/)
          .find((line) => line.startsWith('npx lint-staged'));
        assert.ok(command, 'exercise the actual hook argument list');
        const args = command.trim().split(/\s+/).slice(2);
        const result = spawnSync(
          'node',
          [
            resolve('node_modules/lint-staged/bin/lint-staged.js'),
            ...args,
            '--concurrent',
            '1',
          ],
          { cwd, encoding: 'utf8' }
        );
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.ok(
          JSON.parse(readFileSync(join(cwd, 'checked.json'), 'utf8')).some(
            (file) => file.endsWith('maintained.js')
          )
        );
        assert.equal(
          readFileSync(join(cwd, 'dev/log/reference/sample.js'), 'utf8'),
          '// archived fixture\n'
        );
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  );
  const bunAvailable =
    spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0;
  itUnless(
    sandboxed,
    !bunAvailable && 'Bun is not installed; Bun CI exercises discovery'
  )(
    'uses the real Bun config to exclude archive and generated sentinels',
    () => {
      const cwd = mkdtempSync(join(tmpdir(), 'bun-discovery-'));
      try {
        copyFileSync('bunfig.toml', join(cwd, 'bunfig.toml'));
        for (const dir of ['tests', 'dev/log/reference', 'dist']) {
          mkdirSync(join(cwd, dir), { recursive: true });
        }
        writeFileSync(
          join(cwd, 'tests/owned.test.js'),
          "import {test} from 'bun:test'; test('owned sentinel',()=>{console.log('MAINTAINED_RAN')});\n"
        );
        for (const dir of ['dev/log/reference', 'dist']) {
          writeFileSync(
            join(cwd, dir, 'foreign.test.js'),
            "throw new Error('ARCHIVE_MUST_NOT_EXECUTE');\n"
          );
        }
        const result = spawnSync('bun', ['test', '--timeout', '1000'], {
          cwd,
          encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout + result.stderr, /MAINTAINED_RAN/);
        assert.doesNotMatch(
          result.stdout + result.stderr,
          /ARCHIVE_MUST_NOT_EXECUTE/
        );
        assert.ok(existsSync(join(cwd, 'dist/foreign.test.js')));
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  );
});
