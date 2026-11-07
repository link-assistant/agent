import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, it, expect } from 'test-anywhere';
import {
  HANG_GUARD_MS,
  removeFixture,
  runBounded,
} from './helpers/bounded-run.js';
import { itUnless, sandboxed } from './helpers/skip.js';

const config = JSON.parse(readFileSync('.changeset/config.json', 'utf8'));

function createPrettierBins(dependencies) {
  const bin = join(dependencies, '.bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'prettier'),
    '#!/bin/sh\nexec node "$(dirname "$0")/../prettier/bin/prettier.cjs" "$@"\n',
    { mode: 0o755 }
  );
  writeFileSync(
    join(bin, 'prettier.cmd'),
    '@echo off\r\nnode "%~dp0..\\prettier\\bin\\prettier.cjs" %*\r\n'
  );
}

function cleanupLinkedFixture(cwd, links, failure) {
  removeFixture(cwd, failure, (path, options) => {
    for (const link of links) {
      if (existsSync(link)) {
        unlinkSync(link);
      }
    }
    rmSync(path, options);
  });
}

describe('Changesets release formatter', () => {
  it('uses the same formatter as the project formatting check', () => {
    expect(config.format).toBe('prettier');
  });

  it('references the release Changesets config schema', () => {
    // Deno installs dependencies lazily; this read-only job never runs Changesets.
    const isDeno = typeof Deno !== 'undefined';
    const metadata = JSON.parse(
      readFileSync(
        isDeno
          ? 'package-lock.json'
          : 'node_modules/@changesets/config/package.json',
        'utf8'
      )
    );
    const version = isDeno
      ? metadata.packages['node_modules/@changesets/config'].version
      : metadata.version;
    expect(config.$schema).toBe(
      `https://unpkg.com/@changesets/config@${version}/schema.json`
    );
  });

  itUnless(sandboxed)(
    'versions and formats the real package with Deno absent from PATH',
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'changeset-version-'));
      const dependencies = join(cwd, 'node_modules');
      const links = [
        join(dependencies, '@changesets/cli'),
        join(dependencies, 'prettier'),
      ];
      let failure;
      try {
        for (const file of [
          'package.json',
          'deno.json',
          'deno.lock',
          '.prettierrc',
        ]) {
          copyFileSync(file, join(cwd, file));
        }
        mkdirSync(join(cwd, '.changeset'));
        copyFileSync(
          '.changeset/config.json',
          join(cwd, '.changeset/config.json')
        );
        // Match the Linux release runner even when the checkout uses Windows CRLF.
        const manifest = readFileSync(
          join(cwd, 'package.json'),
          'utf8'
        ).replaceAll('\r\n', '\n');
        writeFileSync(join(cwd, 'package.json'), manifest);
        const pkg = JSON.parse(manifest);
        writeFileSync(
          join(cwd, '.changeset/release-check.md'),
          `---\n"${pkg.name}": patch\n---\n\nCheck release versioning.\n`
        );
        writeFileSync(join(cwd, 'CHANGELOG.md'), `# ${pkg.name}\n`);
        // Deno's automatic installation does not promise npm-style bin links.
        // Give npm a minimal local tree with the actual installed CLI/formatter.
        mkdirSync(join(dependencies, '@changesets'), { recursive: true });
        for (const link of links) {
          const relative = link.slice(dependencies.length + 1);
          symlinkSync(resolve('node_modules', relative), link, 'junction');
        }
        createPrettierBins(dependencies);
        const env = { ...process.env };
        const pathKey = Object.keys(env).find(
          (key) => key.toUpperCase() === 'PATH'
        );
        assert.ok(pathKey, 'The release fixture needs Node and npm on PATH');
        env[pathKey] = env[pathKey]
          .split(delimiter)
          .filter(
            (dir) =>
              !['deno', 'deno.exe', 'deno.cmd'].some((name) =>
                existsSync(join(dir, name))
              )
          )
          .join(delimiter);
        assert.equal(
          spawnSync('deno', ['--version'], { env }).error?.code,
          'ENOENT'
        );
        const budgetMs = HANG_GUARD_MS;
        const run = async (file, args) => {
          try {
            const { stderr, elapsedMs } = await runBounded(
              'node',
              [
                '--require',
                resolve('experiments/trace-changeset-fixture.cjs'),
                resolve(file),
                ...args,
              ],
              {
                cwd,
                env: {
                  ...env,
                  DEBUG_CHANGESET_FIXTURE: '1',
                  // Release formatting must use installed dependencies, never fetch.
                  npm_config_offline: 'true',
                  npm_config_yes: 'false',
                  npm_config_loglevel: 'verbose',
                },
                timeout: budgetMs,
              }
            );
            // Show where the time went while an overrun can still be acted on.
            if (elapsedMs > budgetMs / 2) {
              console.error(
                `${file} took ${elapsedMs} of ${budgetMs} ms\n${stderr}`
              );
            }
          } catch (error) {
            assert.fail(`${error}\n${error.stdout}\n${error.stderr}`);
          }
        };
        await run('node_modules/@changesets/cli/bin.js', ['version']);
        const versionParts = pkg.version.split('.').map(Number);
        versionParts[2] += 1;
        expect(
          JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version
        ).toBe(versionParts.join('.'));
        expect(existsSync(join(cwd, '.changeset/release-check.md'))).toBe(
          false
        );
        expect(readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8')).toContain(
          'Check release versioning.'
        );
        await run('node_modules/prettier/bin/prettier.cjs', [
          '--check',
          'package.json',
          'CHANGELOG.md',
        ]);
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        // Remove shared dependency links without traversing their targets.
        cleanupLinkedFixture(cwd, links, failure);
      }
    }
  );
});

describe('credential-free PR release versioning', () => {
  it('checks the fresh merge in the independent lint job and discards changes', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    const lint = workflow.split('\n  lint:')[1].split('\n  test:')[0];
    expect(lint).toContain('needs: [detect-changes]');
    expect(lint).toContain('Dry-run release versioning');
    expect(lint).toContain('npm run changeset:version');
    expect(lint).toContain(
      "trap 'git restore --source=HEAD --staged --worktree -- .' EXIT"
    );
    expect(lint.indexOf('Dry-run release versioning')).toBeGreaterThan(
      lint.indexOf('Simulate fresh merge')
    );
  });
});
