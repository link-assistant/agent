import { describe, expect, test } from 'bun:test';
import { URL, pathToFileURL } from 'node:url';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { makeConfig } from 'lino-arguments';
import { preflight } from '../../scripts/release-preflight.mjs';
import {
  enforceFreshness,
  reportFreshness,
} from '../../scripts/freshness-policy.mjs';
import { checkVersions } from '../../scripts/check-version.mjs';
import { sourceLimit, violations } from '../../scripts/check-file-size.mjs';
import { missingSections } from '../../scripts/validate-docs.mjs';
import { installGitHooks } from '../src/scripts/install-git-hooks.mjs';

const response = (status, data = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: () => Promise.resolve(data),
});
const npmEnv = {
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.invalid/request?existing=1',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-secret',
};

test('documentation links and prose cannot replace required section headings', () => {
  expect(missingSections('# Guide\n## Usage\n', ['Usage'])).toEqual([]);
  expect(
    missingSections('# Guide\nSee [Usage](#usage)\nUsage examples\n', ['Usage'])
  ).toEqual(['Usage']);
});

test('Husky installation failures do not silently pass prepare', async () => {
  let installed = false;
  const install = () => {
    installed = true;
    return Promise.resolve('installation failed');
  };
  expect(await installGitHooks({ env: { CI: 'true' }, install })).toBe(0);
  expect(installed).toBe(false);
  expect(
    await installGitHooks({
      env: {},
      install,
      readHooksPath: () => '',
      log: () => {},
    })
  ).toBe(1);
  expect(
    await installGitHooks({
      env: {},
      install,
      readHooksPath: () => '.husky/_',
      log: () => {},
    })
  ).toBe(1);
  expect(
    await installGitHooks({
      env: {},
      install: () => Promise.resolve(''),
      readHooksPath: () => '.husky/_',
    })
  ).toBe(0);
});

describe('dependency compatibility (#340)', () => {
  test('unrelated proxy aliases do not prevent CLI configuration', () => {
    const parsed = makeConfig({
      argv: ['bun', 'agent', '--model', 'kilo/nemotron-3-ultra-free'],
      env: {
        HTTP_PROXY: 'http://upper.invalid',
        http_proxy: 'http://lower.invalid',
      },
      lenv: { enabled: false },
      yargs: ({ yargs }) => yargs.option('model', { type: 'string' }),
    });
    expect(parsed.model).toBe('kilo/nemotron-3-ultra-free');
    // Agent startup uses legacy process.env mode, so exercise that path too.
    const entry = createRequire(import.meta.url).resolve('lino-arguments');
    const program = `import { makeConfig } from ${JSON.stringify(pathToFileURL(entry).href)};
      console.log(makeConfig({argv: ['bun', 'agent'], lenv: {enabled: false},
        yargs: ({yargs, getenv}) => yargs.option('verbose', {type: 'boolean', default: getenv('VERBOSE', false)})}).verbose);`;
    const child = spawnSync(process.execPath, ['--eval', program], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HTTP_PROXY: 'http://same.invalid',
        http_proxy: 'http://same.invalid',
      },
    });
    expect(child.stderr).not.toContain('Ambiguous environment aliases');
    expect(child.status).toBe(0);
    expect(child.stdout.trim()).toBe('false');
  });
  test('the deprecated DOMException package is replaced by the native constructor', async () => {
    const require = createRequire(import.meta.url);
    const blobRequire = createRequire(require.resolve('fetch-blob'));
    const Replacement = blobRequire('node-domexception');
    expect(Replacement).toBe(globalThis.DOMException);
    expect(new Replacement('aborted', 'AbortError').name).toBe('AbortError');
    const { Blob: FetchBlob } = await import('fetch-blob');
    expect(await new FetchBlob(['native compatible']).text()).toBe(
      'native compatible'
    );
  });
});

describe('release credential preflight', () => {
  test('verifies package-scoped npm exchange without publishing or leaking credentials', async () => {
    const calls = [];
    const result = await preflight('npm', npmEnv, (url, options) => {
      calls.push([String(url), options]);
      return Promise.resolve(
        calls.length === 1
          ? response(200, { value: 'jwt-secret' })
          : response(201, { token: 'npm-secret' })
      );
    });
    expect(result.verdict).toBe('verified');
    expect(calls[0][0]).toContain(
      'existing=1&audience=npm%3Aregistry.npmjs.org'
    );
    expect(calls[1][0]).toEndWith('/package/%40link-assistant%2Fagent');
    expect(calls[1][1].method).toBe('POST');
    expect(calls.every(([, options]) => !options.body)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  test('missing, denied, malformed and unavailable npm credentials never pass', async () => {
    expect((await preflight('npm', {})).verdict).toBe('denied');
    for (const status of [401, 403, 404, 429, 500]) {
      let count = 0;
      const result = await preflight('npm', npmEnv, () =>
        Promise.resolve(
          ++count === 1 ? response(200, { value: 'jwt' }) : response(status)
        )
      );
      expect(result.verdict).toBe(
        [401, 403, 404].includes(status) ? 'denied' : 'unknown'
      );
    }
    for (const token of ['', null, 123]) {
      let count = 0;
      expect(
        (
          await preflight('npm', npmEnv, () =>
            Promise.resolve(
              ++count === 1
                ? response(200, { value: 'jwt' })
                : response(200, { token })
            )
          )
        ).verdict
      ).toBe('unknown');
    }
    const unreachable = await preflight('npm', npmEnv, () =>
      Promise.reject(new Error('token=secret'))
    );
    expect(unreachable.verdict).toBe('unknown');
    expect(unreachable.message).not.toContain('token=secret');
  });
  test('crates probe omits the archive and recognizes only authenticated parsing', async () => {
    let body;
    const result = await preflight(
      'crates',
      { CARGO_TOKEN: 'crate-secret' },
      (_url, options) => {
        body = options.body;
        return Promise.resolve(
          response(400, { errors: [{ detail: 'invalid tarball length' }] })
        );
      }
    );
    expect(result.verdict).toBe('verified');
    expect(body.readUInt32LE(0)).toBe(body.length - 4);
    expect(JSON.parse(body.subarray(4).toString()).vers).toBe(
      '0.0.0-preflight'
    );
    expect((await preflight('crates', {})).verdict).toBe('denied');
    for (const status of [200, 400, 401, 403, 429, 500]) {
      expect(
        (
          await preflight('crates', { CARGO_TOKEN: 'secret' }, () =>
            Promise.resolve(response(status))
          )
        ).verdict
      ).toBe([401, 403].includes(status) ? 'denied' : 'unknown');
    }
  });
});

describe('external freshness policy', () => {
  test('only a push to main reports drift without failing; manual/scheduled/local/PR runs enforce it', () => {
    for (const GITHUB_EVENT_NAME of [
      'push',
      'pull_request',
      'schedule',
      'workflow_dispatch',
      undefined,
    ]) {
      for (const GITHUB_REF of [
        'refs/heads/main',
        'refs/pull/341/merge',
        undefined,
      ]) {
        const env = { GITHUB_EVENT_NAME, GITHUB_REF };
        const enforce = !(
          GITHUB_EVENT_NAME === 'push' && GITHUB_REF === 'refs/heads/main'
        );
        const messages = [];
        expect(enforceFreshness(env)).toBe(enforce);
        expect(
          reportFreshness(['outdated'], env, (message) =>
            messages.push(message)
          )
        ).toBe(enforce ? 1 : 0);
        expect(messages[0]).toStartWith(enforce ? '::error::' : '::warning::');
        expect(reportFreshness([], env)).toBe(0);
      }
    }
  });
});

describe('repository guards', () => {
  const manifests = {
    'js/package.json': '{"version":"1.0.0"}',
    'rust/Cargo.toml': '[package]\nname = "test"\nversion = "1.0.0"\n',
  };
  test('manual versions in either language fail independently', () => {
    const before = (file) => manifests[file];
    expect(() => checkVersions(before, before)).not.toThrow();
    for (const changed of Object.keys(manifests)) {
      expect(() =>
        checkVersions(before, (file) =>
          file === changed
            ? manifests[file].replace('1.0.0', '2.0.0')
            : manifests[file]
        )
      ).toThrow('Manual version change');
    }
  });
  test('TypeScript/Rust/shell are covered and archived evidence is excluded', () => {
    for (const file of [
      'js/src/new.ts',
      'js/src/view.tsx',
      'rust/src/new.rs',
      'scripts/new.sh',
    ]) {
      expect(violations([file], () => '\n'.repeat(1501))).toHaveLength(1);
    }
    expect(sourceLimit('dev/log/issues/340/snapshot.js')).toBe(null);
    expect(
      violations(['js/src/auth/plugins.ts'], () => '\n'.repeat(1501))
    ).toHaveLength(1);
  });
  test('lint warnings fail and dependency installs are frozen', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    );
    expect(pkg.scripts.lint).toContain('--max-warnings 0');
    for (const name of [
      'js',
      'rust',
      'dependency-freshness',
      'model-drift',
      'model-catalogue',
      'security',
      'workflows',
    ]) {
      const yaml = readFileSync(
        new URL(`../../.github/workflows/${name}.yml`, import.meta.url),
        'utf8'
      );
      expect(yaml).not.toMatch(/ubuntu-latest|macos-latest|windows-latest/);
      expect(yaml).not.toMatch(/bun install\s*$/m);
      expect(yaml).not.toContain('npm install --legacy-peer-deps');
    }
  });
});

test('prepare is available in a standalone package source copy', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  );
  const script = pkg.scripts.prepare.split(' ')[1];
  const root = mkdtempSync(join(tmpdir(), 'prepare-package-340-'));
  try {
    mkdirSync(join(root, 'src/scripts'), { recursive: true });
    copyFileSync(new URL(`../${script}`, import.meta.url), join(root, script));
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
    // npm pack can run prepare while packing a copy without repo helpers.
    const result = spawnSync('node', [script], {
      cwd: root,
      env: { ...process.env, CI: 'true' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
