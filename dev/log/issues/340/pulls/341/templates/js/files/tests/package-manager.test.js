import { describe, it, expect } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { itUnless, sandboxed } from './helpers/skip.js';

const scriptPath = fileURLToPath(
  new URL('../scripts/check-package-manager.mjs', import.meta.url)
);
const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

function createFixture(pkg, extraFiles = []) {
  const root = path.join(
    tmpdir(),
    `pkg-mgr-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify(pkg, null, 2)}\n`
  );

  for (const file of extraFiles) {
    writeFileSync(path.join(root, file), '{}\n');
  }

  return root;
}

function runGuard(cwd) {
  return spawnSync('node', [scriptPath], { cwd, encoding: 'utf8' });
}

describe('package.json declares the package manager', () => {
  it('declares npm through devEngines, which detect() honours over lockfiles', () => {
    expect(packageJson.devEngines?.packageManager?.name).toBe('npm');
  });
});

describe('check-package-manager.mjs', () => {
  for (const config of ['deno.json', 'deno.jsonc']) {
    itUnless(sandboxed)(`recognizes deno.lock owned by ${config}`, () => {
      const root = createFixture(
        { name: 'fixture', packageManager: 'npm@11.19.0' },
        ['deno.lock', config]
      );
      try {
        const result = runGuard(root);
        expect(result.status).toBe(0);
        expect(result.stderr).not.toContain('::warning::');
        expect(result.stdout).toContain(
          `deno.lock (kept by Deno for ${config})`
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  itUnless(sandboxed)(
    'warns only about unexpected lockfiles alongside a runtime-owned lock',
    () => {
      const root = createFixture({ name: 'fixture', packageManager: 'npm' }, [
        'deno.lock',
        'deno.json',
        'bun.lock',
      ]);
      try {
        const result = runGuard(root);
        expect(result.status).toBe(0);
        expect(result.stderr).toContain('::warning::');
        expect(result.stderr).toContain('bun.lock');
        expect(result.stderr).not.toContain('deno.lock');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed)(
    'passes on the repository package and runtime locks',
    () => {
      // bun install creates an untracked bun.lock on CI. Test the shipped inputs
      // in isolation; the foreign-lock fixtures above must still warn about it.
      const root = createFixture(packageJson, [
        'package-lock.json',
        'deno.lock',
        'deno.json',
      ]);
      try {
        const result = runGuard(root);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Package manager check passed');
        expect(result.stderr).not.toContain('::warning::');
        expect(result.stdout).toContain(
          'deno.lock (kept by Deno for deno.json)'
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed)(
    'fails when neither packageManager nor devEngines is declared',
    () => {
      const root = createFixture({ name: 'fixture' });

      try {
        const result = runGuard(root);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
          'declares neither "packageManager" nor "devEngines.packageManager"'
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed)(
    'fails on a declaration naming a manager the flow cannot use',
    () => {
      const root = createFixture({
        name: 'fixture',
        devEngines: { packageManager: { name: 'bun' } },
      });

      try {
        const result = runGuard(root);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('requires "npm"');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed)('parses a versioned packageManager field', () => {
    const root = createFixture({
      name: 'fixture',
      packageManager: 'npm@10.9.1',
    });

    try {
      const result = runGuard(root);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('declared "npm@10.9.1"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  itUnless(sandboxed)(
    'warns but passes when a foreign lockfile sits under a declaration',
    () => {
      const root = createFixture(
        { name: 'fixture', devEngines: { packageManager: { name: 'npm' } } },
        ['bun.lock', 'deno.lock', 'upm.lock']
      );

      try {
        const result = runGuard(root);

        expect(result.status).toBe(0);
        expect(result.stderr).toContain('::warning::');
        expect(result.stderr).toContain('bun.lock');
        expect(result.stderr).toContain('deno.lock');
        expect(result.stderr).toContain('upm.lock');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed)(
    'fails and names the lockfile when a foreign lockfile has no declaration',
    () => {
      const root = createFixture({ name: 'fixture' }, ['deno.lock']);

      try {
        const result = runGuard(root);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('deno.lock');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  it('runs ahead of the install step in the release workflow', () => {
    // Several jobs in release.yml install dependencies; the guard has to
    // precede the install step that follows it in the Release job.
    const checkStep = releaseWorkflow.indexOf(
      'Check package manager declaration and lockfiles'
    );
    const installStep = releaseWorkflow.indexOf(
      'name: Install dependencies',
      checkStep
    );

    expect(checkStep).toBeGreaterThan(-1);
    expect(installStep).toBeGreaterThan(checkStep);
    expect(releaseWorkflow).toContain(
      'run: node scripts/check-package-manager.mjs'
    );
  });
});
