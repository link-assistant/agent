/**
 * Tests for create-github-release.mjs CLI behavior.
 * failed gh api calls must not be reported as success.
 * release names should be human-readable titles.
 */

import { describe, it, expect } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import {
  buildReleasePayload,
  createRelease,
  extractReleaseNotes,
  GITHUB_RELEASE_BODY_MAX_BYTES,
  parseArgs,
} from '../scripts/create-github-release.mjs';
import { itUnless, sandboxed, windowsNodeCmd } from './helpers/skip.js';

const scriptPath = fileURLToPath(
  new URL('../scripts/create-github-release.mjs', import.meta.url)
);
const textEncoder = new globalThis.TextEncoder();
// Node on Windows does not execute the .cmd gh fixture through spawnSync.
// The injected-spawn tests below cover release result handling on that runner.

function prependPath(env, binPath) {
  const nextEnv = { ...env };
  const currentPath =
    Object.entries(nextEnv).find(
      ([key]) => key.toLowerCase() === 'path'
    )?.[1] ?? '';
  const fixturePath = `${binPath}${path.delimiter}${currentPath}`;

  // Windows treats these keys alike; child_process picks the first sorted key.
  // Keep all aliases equal so a blank PATH cannot hide a populated Path.
  for (const key of Object.keys(nextEnv)) {
    if (key.toLowerCase() === 'path') {
      nextEnv[key] = fixturePath;
    }
  }

  return {
    ...nextEnv,
    [process.platform === 'win32' ? 'Path' : 'PATH']: fixturePath,
  };
}

describe('release fixture PATH isolation', () => {
  it('gives every case variant the same path and preserves the parent', () => {
    const parent = { PATH: '/original', Path: '/original', OTHER: 'kept' };
    const env = prependPath(parent, '/fixture/bin');
    const expected = `/fixture/bin${path.delimiter}/original`;

    expect(env.PATH).toBe(expected);
    expect(env.Path).toBe(expected);
    expect(env.OTHER).toBe('kept');
    expect(parent).toEqual({
      PATH: '/original',
      Path: '/original',
      OTHER: 'kept',
    });
  });
});

function createFixture({ jsRoot = '.' } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'create-release-'));
  const binPath = path.join(root, 'bin');
  const packageRoot = jsRoot === '.' ? root : path.join(root, jsRoot);

  mkdirSync(binPath, { recursive: true });
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      name: jsRoot === '.' ? 'fixture-package' : '@scope/js-package',
      version: '1.2.3',
    })
  );
  writeFileSync(
    path.join(packageRoot, 'CHANGELOG.md'),
    `# Changelog

## 1.2.3

### Patch Changes

- Fix release creation

## 1.2.2

- Previous release
`
  );

  const fakeGhJs = path.join(binPath, 'fake-gh.cjs');
  writeFileSync(
    fakeGhJs,
    `#!/usr/bin/env node
const fs = require('node:fs');

const input = fs.readFileSync(0, 'utf8');

if (process.env.FAKE_GH_PAYLOAD_FILE) {
  fs.writeFileSync(process.env.FAKE_GH_PAYLOAD_FILE, input);
}

if (process.env.FAKE_GH_ARGS_FILE) {
  fs.writeFileSync(
    process.env.FAKE_GH_ARGS_FILE,
    JSON.stringify(process.argv.slice(2))
  );
}

if (process.env.FAKE_GH_MODE === 'success') {
  console.log(JSON.stringify({ id: 123 }));
  process.exit(0);
}

if (process.env.FAKE_GH_MODE === 'already_exists') {
  console.error('gh: Validation Failed (HTTP 422)');
  console.error('already_exists');
  process.exit(1);
}

console.error('gh: synthetic server error');
process.exit(1);
`
  );

  const fakeGhPath = path.join(binPath, 'gh');
  writeFileSync(
    fakeGhPath,
    `#!/bin/sh
exec "${process.execPath}" ${globalThis.Deno ? 'run -A ' : ''}"$(dirname "$0")/fake-gh.cjs" "$@"
`
  );
  chmodSync(fakeGhPath, 0o755);

  writeFileSync(
    path.join(binPath, 'gh.cmd'),
    `@echo off\r\n"${process.execPath}" ${globalThis.Deno ? 'run -A ' : ''}"%~dp0fake-gh.cjs" %*\r\n`
  );

  return root;
}

function runCreateRelease(root, mode, extraArgs = []) {
  const argsFile = path.join(root, 'gh-args.json');
  const payloadFile = path.join(root, 'gh-payload.json');
  const binPath = path.join(root, 'bin');
  const env = prependPath(
    {
      ...process.env,
      FAKE_GH_ARGS_FILE: argsFile,
      FAKE_GH_MODE: mode,
      FAKE_GH_PAYLOAD_FILE: payloadFile,
    },
    binPath
  );

  return {
    argsFile,
    payloadFile,
    result: spawnSync(
      process.execPath,
      [
        scriptPath,
        '--release-version',
        '1.2.3',
        '--repository',
        'owner/repo',
        ...extraArgs,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env,
      }
    ),
  };
}

function createSpawnRecorder(result) {
  const calls = [];

  return {
    calls,
    spawn(command, args, options) {
      calls.push({ args, command, options });
      return result;
    },
  };
}

function getUtf8ByteLength(value) {
  return textEncoder.encode(value).byteLength;
}

describe('create-github-release release note extraction', () => {
  it('extracts notes for an exact version header', () => {
    const changelog = `# Changelog

## 1.2.3

- newer notes

## 1.2

- older notes
`;

    expect(extractReleaseNotes(changelog, '1.2')).toBe('- older notes');
  });
});

describe('create-github-release release title formatting', () => {
  it('parses language from CLI arguments and environment defaults', () => {
    expect(parseArgs([], {})).toEqual({
      jsRoot: '',
      language: 'JavaScript',
      releaseVersion: '',
      repository: '',
      tagPrefix: undefined,
    });
    expect(parseArgs([], { LANGUAGE: 'TypeScript' })).toEqual({
      jsRoot: '',
      language: 'TypeScript',
      releaseVersion: '',
      repository: '',
      tagPrefix: undefined,
    });
    expect(parseArgs(['--language', 'JavaScript'], {})).toEqual({
      jsRoot: '',
      language: 'JavaScript',
      releaseVersion: '',
      repository: '',
      tagPrefix: undefined,
    });
    expect(parseArgs(['--language=Rust'], {})).toEqual({
      jsRoot: '',
      language: 'Rust',
      releaseVersion: '',
      repository: '',
      tagPrefix: undefined,
    });
  });

  it('builds a human-readable release name from a multi-language tag', () => {
    const changelog = `# Changelog

## 1.2.3

- Fix release creation
`;

    expect(
      JSON.parse(
        buildReleasePayload({
          changelog,
          jsRoot: 'js',
          language: 'JavaScript',
          packageName: '@scope/js-package',
          tag: 'js_v1.2.3',
          version: '1.2.3',
        })
      )
    ).toEqual({
      tag_name: 'js_v1.2.3',
      name: '[JavaScript] 1.2.3',
      body: '- Fix release creation',
    });
  });

  it('caps oversized release notes and links to the tagged changelog', () => {
    const multibyteCharacter = '\u{1f680}';
    const largeEntry = `- ${multibyteCharacter.repeat(
      GITHUB_RELEASE_BODY_MAX_BYTES / 2
    )}`;
    const changelog = `# Changelog

## 1.2.3

${largeEntry}

## 1.2.2

- Previous release
`;

    const payload = JSON.parse(
      buildReleasePayload({
        changelog,
        language: 'JavaScript',
        repository: 'owner/repo',
        tag: 'v1.2.3',
        version: '1.2.3',
      })
    );

    expect(getUtf8ByteLength(payload.body)).toBeLessThanOrEqual(
      GITHUB_RELEASE_BODY_MAX_BYTES
    );
    expect(
      payload.body.startsWith(`- ${multibyteCharacter}${multibyteCharacter}`)
    ).toBe(true);
    expect(payload.body).toContain(
      'https://github.com/owner/repo/blob/v1.2.3/CHANGELOG.md'
    );
  });
});

describe('create-github-release.mjs', () => {
  it('uses gh api and reports successful creation only for exit code 0', () => {
    const payload = JSON.stringify({ tag_name: 'v1.2.3' });
    const { calls, spawn } = createSpawnRecorder({
      status: 0,
      stderr: '',
      stdout: JSON.stringify({ id: 123 }),
    });

    expect(createRelease({ payload, repository: 'owner/repo', spawn })).toEqual(
      {
        alreadyExists: false,
      }
    );
    expect(calls).toEqual([
      {
        args: [
          'api',
          'repos/owner/repo/releases',
          '-X',
          'POST',
          '--input',
          '-',
        ],
        command: 'gh',
        options: {
          encoding: 'utf8',
          input: payload,
        },
      },
    ]);
  });

  it('throws when gh api exits non-zero with an unexpected error', () => {
    const { spawn } = createSpawnRecorder({
      status: 1,
      stderr: 'gh: synthetic server error',
      stdout: '',
    });
    let thrownError;

    try {
      createRelease({
        payload: '{}',
        repository: 'owner/repo',
        spawn,
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError.message).toContain('gh api failed with code 1');
    expect(thrownError.message).toContain('synthetic server error');
  });

  it('treats already_exists as an idempotent gh api result', () => {
    const { spawn } = createSpawnRecorder({
      status: 1,
      stderr: 'already_exists',
      stdout: '',
    });

    expect(
      createRelease({
        payload: '{}',
        repository: 'owner/repo',
        spawn,
      })
    ).toEqual({ alreadyExists: true });
  });

  itUnless(sandboxed, windowsNodeCmd)(
    'passes release payload to gh api and reports success only on exit code 0',
    () => {
      const root = createFixture();

      try {
        const { argsFile, payloadFile, result } = runCreateRelease(
          root,
          'success'
        );

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Creating GitHub release for v1.2.3');
        expect(result.stdout).toContain('Created GitHub release: v1.2.3');
        expect(JSON.parse(readFileSync(argsFile, 'utf8'))).toEqual([
          'api',
          'repos/owner/repo/releases',
          '-X',
          'POST',
          '--input',
          '-',
        ]);
        expect(JSON.parse(readFileSync(payloadFile, 'utf8'))).toEqual({
          tag_name: 'v1.2.3',
          name: 'fixture-package 1.2.3',
          body: '### Patch Changes\n\n- Fix release creation',
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed, windowsNodeCmd)(
    'auto-detects multi-language release tags and titles',
    () => {
      const root = createFixture({ jsRoot: 'js' });

      try {
        const { payloadFile, result } = runCreateRelease(root, 'success');

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(
          'Creating GitHub release for js_v1.2.3'
        );
        expect(JSON.parse(readFileSync(payloadFile, 'utf8'))).toEqual({
          tag_name: 'js_v1.2.3',
          name: '[JavaScript] 1.2.3',
          body: '### Patch Changes\n\n- Fix release creation',
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed, windowsNodeCmd)(
    'fails when gh api exits non-zero with an unexpected error',
    () => {
      const root = createFixture();

      try {
        const { result } = runCreateRelease(root, 'failure');

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('Creating GitHub release for v1.2.3');
        expect(result.stdout).not.toContain('Created GitHub release');
        expect(result.stderr).toContain('gh api failed with code 1');
        expect(result.stderr).toContain('synthetic server error');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed, windowsNodeCmd)(
    'treats already_exists as an explicit idempotent skip',
    () => {
      const root = createFixture();

      try {
        const { result } = runCreateRelease(root, 'already_exists');

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(
          'GitHub release already exists: v1.2.3. Skipping creation.'
        );
        expect(result.stdout).not.toContain('Created GitHub release');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});
