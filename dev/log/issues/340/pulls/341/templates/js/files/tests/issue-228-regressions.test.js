import { describe, expect, it } from 'test-anywhere';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  publishWithRetry,
  waitForVersionOnRegistry,
} from '../scripts/publish-retry.mjs';
import { parseArgs, waitForNpmVersion } from '../scripts/wait-for-npm.mjs';
import { itUnless, sandboxed } from './helpers/skip.js';
import { HANG_GUARD_MS } from './helpers/bounded-run.js';

const read = (file) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const workflow = read('.github/workflows/workflows.yml');

describe('repository-wide workflow audit coverage', () => {
  it('triggers on all GitHub configs/actions and every script the jobs execute', () => {
    const scripts = [
      ...new Set(workflow.match(/scripts\/[\w.-]+\.(?:mjs|sh)/g)),
    ];
    const filters = [...workflow.matchAll(/^ {4}paths:\n((?: {6}- .+\n)+)/gm)];
    expect(filters.length).toBe(2);
    for (const [, filter] of filters) {
      expect(filter).toContain("'.github/**'");
      for (const script of scripts) {
        expect(filter).toContain(`'${script}'`);
      }
    }
  });

  it('reproduces the regular action audit against the entire repository', () => {
    expect(workflow).toMatch(/--min-confidence low --persona regular \./);
  });

  it('authenticates the pedantic audit and scans the entire repository', () => {
    const step = workflow.slice(
      workflow.indexOf('- name: Audit for pedantic-only')
    );
    expect(step).toContain('GH_TOKEN: ${{ github.token }}');
    expect(step).toMatch(/--min-confidence high \\\n\s+\.\n/);
  });
});

describe('link checker input selection', () => {
  it('walks hidden Markdown and HTML while retaining ignore/exclusion rules', () => {
    const workflow = read('.github/workflows/links.yml');
    const args = workflow.match(/^ {10}args: >-\n((?: {12}.*\n)+)/m)[1];
    expect(args).toContain('--hidden');
    expect(args).toContain('--extensions md,html');
    expect(args).not.toContain('*');
    expect(args.trim().endsWith('\n            .')).toBe(true);
    for (const file of [
      'docs/case-studies',
      'dev/log',
      'examples/universal-app/index.html',
      'tests/fixtures',
    ]) {
      expect(args).toContain(`--exclude-path ${file}`);
    }
  });
});

describe('Deno lock and npm install script policies', () => {
  it('keeps Deno workspace dependency ranges synchronized with package.json', () => {
    const lock = JSON.parse(read('deno.lock'));
    const pkg = JSON.parse(read('package.json'));
    const expected = Object.entries({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    })
      .map(
        ([name, range]) =>
          `npm:${name}@${range.replace(/^\^(0\.[1-9]\d*\.\d+)/, '~$1')}`
      )
      .sort();
    expect([...lock.workspace.packageJson.dependencies].sort()).toEqual(
      expected
    );
    for (const dependency of expected) {
      expect(typeof lock.specifiers[dependency]).toBe('string');
    }
  });

  it('requires an explicit decision for every install script, including optional OS packages', () => {
    const root = 'examples/universal-app/';
    const pkg = JSON.parse(read(`${root}package.json`));
    const lock = JSON.parse(read(`${root}package-lock.json`));
    const scripts = Object.entries(lock.packages)
      .filter(([, info]) => info.hasInstallScript)
      .map(
        ([entry, info]) =>
          `${info.name ?? entry.split('node_modules/').at(-1)}@${info.version}`
      );
    expect(scripts.length).toBeGreaterThan(0);
    for (const name of scripts) {
      expect(typeof pkg.allowScripts?.[name]).toBe('boolean');
    }
    expect(pkg.allowScripts).toEqual({
      'electron-winstaller@5.4.0': true,
      'esbuild@0.25.12': true,
      'fsevents@2.3.3': true,
    });
  });
});

describe('npm propagation tail', () => {
  it('verifies a version visible after 950 seconds without publishing twice', async () => {
    let now = 0;
    let publishes = 0;
    const logs = [];
    const result = await publishWithRetry({
      publish: async () => {
        publishes++;
        return { success: true };
      },
      verify: async () => now >= 950000,
      sleepFn: async (ms) => {
        now += ms;
      },
      log: (message) => logs.push(message),
    });
    expect(result.success).toBe(true);
    expect(publishes).toBe(1);
    expect(now).toBe(960000);
    expect(logs.at(-1)).toContain('after ~960s');
  });

  it('bounds absent-version verification at 25.5 minutes and reports elapsed wait', async () => {
    let now = 0;
    const logs = [];
    expect(
      await waitForVersionOnRegistry({
        verify: async () => false,
        sleepFn: async (ms) => {
          now += ms;
        },
        log: (message) => logs.push(message),
      })
    ).toBe(false);
    expect(now).toBe(1530000);
    expect(logs.at(-1)).toContain('1530s');
  });

  it('gives smoke/Docker waits the same 25.5-minute polling span', async () => {
    let now = 0;
    const { maxAttempts, sleepSeconds } = parseArgs([], {});
    const result = await waitForNpmVersion({
      packageName: 'fixture',
      version: '1.0.0',
      maxAttempts,
      sleepSeconds,
      checkAvailability: async () => now >= 950,
      sleepFn: async (seconds) => {
        now += seconds;
      },
      stdout: () => {},
    });
    expect(result.available).toBe(true);
    expect((maxAttempts - 1) * sleepSeconds).toBe(1530);
  });
});

describe('quiet, effective tooling configuration', () => {
  it('uses jscpd 5 weak mode to omit comments', () => {
    const config = JSON.parse(read('.jscpd.json'));
    expect(config.mode).toBe('weak');
    expect(config.skipComments).toBe(undefined);
  });

  itUnless(sandboxed)(
    'the installed jscpd parser accepts every config field',
    () => {
      const fixture = mkdtempSync(path.join(tmpdir(), 'jscpd-config-'));
      try {
        writeFileSync(
          path.join(fixture, 'sample.js'),
          'export const value = 1;\n'
        );
        const result = spawnSync(
          process.execPath,
          [
            path.resolve('node_modules/jscpd/run-jscpd.js'),
            '--config',
            path.resolve('.jscpd.json'),
            '--reporters',
            'silent',
            '--threshold',
            '100',
            fixture,
          ],
          { encoding: 'utf8', timeout: HANG_GUARD_MS }
        );
        expect(`${result.stdout}${result.stderr}`).not.toMatch(
          /unknown field/i
        );
        expect(result.status).toBe(0);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  );

  it('retains captured failure analysis without replaying live publish output', () => {
    const script = read('scripts/publish-to-npm.mjs');
    expect(script).not.toContain("console.log('Changeset output:'");
    expect(script).toContain('detectPublishFailure(combinedOutput)');
  });
});
