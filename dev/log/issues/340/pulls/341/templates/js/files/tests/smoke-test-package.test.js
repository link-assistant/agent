import { describe, it, expect } from 'test-anywhere';
import { join } from 'node:path';

import {
  buildLibraryCheckSource,
  checkCliEntryPoints,
  formatOutputPreview,
  getBinEntries,
  hasLibraryEntryPoint,
  installFromNpm,
  parseArgs,
  parseCommandArgs,
  resolveBinShim,
} from '../scripts/smoke-test-package.mjs';

describe('smoke-test-package.mjs', () => {
  it('parses package smoke test options', () => {
    expect(
      parseArgs(
        [
          '--package-version',
          '1.2.3',
          '--package-name=@scope/pkg',
          '--max-attempts',
          '2',
          '--sleep-seconds=1',
          '--cli-args',
          'add 2 3',
          '--server-bin',
          'pkg',
          '--server-args',
          'serve --port 38217',
          '--server-health-url',
          'http://localhost:38217/health',
        ],
        {}
      )
    ).toEqual({
      cliArgs: ['add', '2', '3'],
      jsRoot: '',
      maxAttempts: 2,
      packageName: '@scope/pkg',
      packageVersion: '1.2.3',
      serverArgs: ['serve', '--port', '38217'],
      serverBin: 'pkg',
      serverHealthUrl: 'http://localhost:38217/health',
      serverTimeoutSeconds: 15,
      skipCli: false,
      skipLibrary: false,
      sleepSeconds: 1,
    });
  });

  it('accepts JSON arrays for command arguments', () => {
    expect(parseCommandArgs('["serve","--port","38217"]')).toEqual([
      'serve',
      '--port',
      '38217',
    ]);
  });

  it('requires values for non-boolean options', () => {
    let errorMessage = '';

    try {
      parseArgs(['--package-version'], {});
    } catch (error) {
      errorMessage = error.message;
    }

    expect(errorMessage).toBe('Missing value for --package-version');
  });

  it('treats empty environment options as unset', () => {
    expect(
      parseArgs(['--package-version', '1.2.3'], { MAX_ATTEMPTS: '' })
        .maxAttempts
    ).toBe(35);
  });

  it('derives advertised npm bin entries', () => {
    expect(
      getBinEntries(
        {
          bin: {
            pkg: './bin/pkg.js',
            'pkg-admin': './bin/admin.js',
          },
        },
        '@scope/pkg'
      )
    ).toEqual([
      { name: 'pkg', path: './bin/pkg.js' },
      { name: 'pkg-admin', path: './bin/admin.js' },
    ]);

    expect(getBinEntries({ bin: './cli.js' }, '@scope/pkg')).toEqual([
      { name: 'pkg', path: './cli.js' },
    ]);
  });

  it('detects whether the installed package has a library entry point', () => {
    expect(hasLibraryEntryPoint({ exports: { '.': './index.js' } })).toBe(true);
    expect(hasLibraryEntryPoint({ main: './index.js' })).toBe(true);
    expect(hasLibraryEntryPoint({ bin: './cli.js' })).toBe(false);
  });

  it('builds a safe library import probe for scoped packages', () => {
    const source = buildLibraryCheckSource('@scope/pkg');

    expect(source).toContain('import * as packageModule from "@scope/pkg"');
    expect(source).toContain('Object.keys(packageModule)');
  });
});

describe('smoke-test-package entry point checks', () => {
  it('resolves npm-installed bin shims for each platform', () => {
    expect(resolveBinShim('/tmp/work', 'pkg', 'linux')).toBe(
      join('/tmp/work', 'node_modules', '.bin', 'pkg')
    );
    expect(resolveBinShim('/tmp/work', 'pkg', 'win32')).toBe(
      `${join('/tmp/work', 'node_modules', '.bin', 'pkg')}.cmd`
    );
  });

  it('retries npm installs to absorb registry propagation lag', async () => {
    let attempts = 0;
    const sleeps = [];

    await installFromNpm({
      cwd: '/tmp/work',
      maxAttempts: 3,
      packageSpec: '@scope/pkg@1.2.3',
      runCommandFn(command, args, options) {
        attempts++;
        expect(command).toBe('npm');
        expect(args).toEqual([
          'install',
          '@scope/pkg@1.2.3',
          '--no-audit',
          '--no-fund',
          '--package-lock=false',
        ]);
        expect(options.cwd).toBe('/tmp/work');

        if (attempts === 1) {
          throw new Error('registry lag');
        }
      },
      sleepFn(seconds) {
        sleeps.push(seconds);
        return Promise.resolve();
      },
      sleepSeconds: 2,
      stdout() {},
    });

    expect(attempts).toBe(2);
    expect(sleeps).toEqual([2]);
  });

  it('captures CLI output before previewing it', () => {
    const calls = [];
    const logs = [];

    checkCliEntryPoints({
      binEntries: [{ name: 'pkg', path: './bin/pkg.js' }],
      cliArgs: ['--list'],
      runCommandFn(command, args, options) {
        calls.push({ args, command, options });
        return ['one', 'two', 'three', 'four', 'five', 'six'].join('\n');
      },
      stdout(message) {
        logs.push(message);
      },
      workspace: '/tmp/work',
    });

    expect(calls.length).toBe(1);
    expect(calls[0].command).toBe(resolveBinShim('/tmp/work', 'pkg'));
    expect(calls[0].args).toEqual(['--list']);
    expect(calls[0].options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(calls[0].options.encoding).toBe('utf8');
    expect(logs).toContain(['one', 'two', 'three', 'four', 'five'].join('\n'));
  });

  it('previews captured output without using a live process pipe', () => {
    expect(
      formatOutputPreview(
        ['one', 'two', 'three', 'four', 'five', 'six'].join('\n')
      )
    ).toBe(['one', 'two', 'three', 'four', 'five'].join('\n'));
  });
});
