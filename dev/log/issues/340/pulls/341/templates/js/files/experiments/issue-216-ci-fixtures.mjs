// Reproduce clean Deno installs and Windows-style checkouts in disposable trees.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'release-ci-fixtures-'));
const expectFailure = process.argv.includes('--expect-failure');
try {
  for (const kind of ['crlf', 'deno']) {
    const cwd = join(root, kind);
    execFileSync('git', ['worktree', 'add', '--detach', cwd, 'HEAD']);
    try {
      if (kind === 'crlf') {
        // Model the manifest's line endings in a Windows Git checkout.
        writeFileSync(
          join(cwd, 'package.json'),
          readFileSync(join(cwd, 'package.json'), 'utf8').replace(
            /\r?\n/g,
            '\r\n'
          )
        );
        assert.match(readFileSync(join(cwd, 'package.json'), 'utf8'), /\r\n/);
        symlinkSync(
          resolve('node_modules'),
          join(cwd, 'node_modules'),
          'junction'
        );
      }
      copyFileSync(
        'tests/changeset-config.test.js',
        join(cwd, 'tests/changeset-config.test.js')
      );
      const command = kind === 'deno' ? 'deno' : process.execPath;
      const args =
        kind === 'deno'
          ? [
              'test',
              '--allow-read',
              ...(process.argv.includes('--full-deno')
                ? []
                : ['tests/changeset-config.test.js']),
            ]
          : [
              '--test',
              '--test-timeout=30000',
              'tests/changeset-config.test.js',
            ];
      const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
      console.log(
        `${kind}: exit ${result.status}\n${result.stdout}\n${result.stderr}`
      );
      assert.equal(
        result.status,
        expectFailure ? 1 : 0,
        String(result.error || 'Unexpected fixture result')
      );
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', cwd]);
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
