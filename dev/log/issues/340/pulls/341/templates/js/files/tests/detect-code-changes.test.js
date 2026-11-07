import { blankEnv } from './helpers/env.js';
import { describe, expect } from 'test-anywhere';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { itUnless, sandboxed } from './helpers/skip.js';

const scriptPath = fileURLToPath(
  new URL('../scripts/detect-code-changes.mjs', import.meta.url)
);

function runGit(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${
        result.stderr
      }`
    );
  }
}

function commit(root, message) {
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', message]);
}

function createMergeCommitFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'detect-code-changes-'));

  runGit(root, ['init', '-b', 'main']);
  runGit(root, ['config', 'user.email', 'ci@example.com']);
  runGit(root, ['config', 'user.name', 'CI Test']);

  writeFileSync(path.join(root, 'README.md'), '# Fixture\n');
  commit(root, 'Initial commit');

  runGit(root, ['checkout', '-b', 'feature']);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(
    path.join(root, 'src', 'index.mjs'),
    'export const value = 1;\n'
  );
  commit(root, 'Add source change');

  mkdirSync(path.join(root, 'docs'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'notes.md'), '# Notes\n');
  commit(root, 'Add docs change');

  runGit(root, ['checkout', 'main']);
  runGit(root, ['merge', '--no-ff', 'feature', '-m', 'Merge feature']);

  return root;
}

function createChangeFixture(filePath, eventName, options = {}) {
  const { packageRoot = '.' } = options;
  const root = mkdtempSync(path.join(tmpdir(), 'detect-code-changes-'));

  runGit(root, ['init', '-b', 'main']);
  runGit(root, ['config', 'user.email', 'ci@example.com']);
  runGit(root, ['config', 'user.name', 'CI Test']);

  writeFileSync(path.join(root, 'README.md'), '# Fixture\n');
  mkdirSync(path.join(root, packageRoot), { recursive: true });
  writeFileSync(
    path.join(root, packageRoot, 'package.json'),
    '{ "name": "fixture" }\n'
  );
  commit(root, 'Initial commit');

  if (eventName === 'pull_request') {
    runGit(root, ['checkout', '-b', 'feature']);
  }

  mkdirSync(path.dirname(path.join(root, filePath)), { recursive: true });
  // Bun reads bunfig.toml from its working directory, so it must parse.
  const content = filePath.endsWith('.toml')
    ? '# Fixture change\n'
    : 'export const ignored = true;\n';
  writeFileSync(path.join(root, filePath), content);
  commit(root, 'Add excluded file');

  if (eventName === 'pull_request') {
    runGit(root, ['checkout', 'main']);
    runGit(root, ['merge', '--no-ff', 'feature', '-m', 'Synthetic PR merge']);
  }

  return root;
}

function runDetectCodeChanges(root, eventName) {
  const outputFile = path.join(root, 'github-output.txt');
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...blankEnv(process.env, (key) => /^(GITHUB_|CI$|JS_ROOT$)/.test(key)),
      GITHUB_EVENT_NAME: eventName,
      GITHUB_OUTPUT: outputFile,
    },
  });

  return {
    outputs: readFileSync(outputFile, 'utf8'),
    result,
  };
}

describe('detect-code-changes CLI', () => {
  itUnless(sandboxed)(
    'detects code introduced by a real merge commit pushed to main',
    () => {
      const root = createMergeCommitFixture();

      try {
        const { outputs, result } = runDetectCodeChanges(root, 'push');

        expect(result.status).toBe(0);
        expect(outputs).toContain('js-changed=true\n');
        expect(outputs).toContain('docs-changed=true\n');
        expect(outputs).toContain('any-code-changed=true\n');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  );

  itUnless(sandboxed)(
    'keeps pull request merge commits scoped to the PR head commit diff',
    () => {
      const root = createMergeCommitFixture();

      try {
        const { outputs, result } = runDetectCodeChanges(root, 'pull_request');

        expect(result.status).toBe(0);
        expect(outputs).toContain('js-changed=false\n');
        expect(outputs).toContain('docs-changed=true\n');
        expect(outputs).toContain('any-code-changed=false\n');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  );

  for (const eventName of ['pull_request', 'push']) {
    for (const filePath of [
      'experiments/repro.mjs',
      'dev/log/repro.js',
      'docs/case-studies/issue-113/repro.md',
    ]) {
      itUnless(sandboxed)(`ignores ${filePath} changes on ${eventName}`, () => {
        const root = createChangeFixture(filePath, eventName);

        try {
          const { outputs, result } = runDetectCodeChanges(root, eventName);

          expect(result.status).toBe(0);
          expect(outputs).toContain('js-changed=false\n');
          expect(outputs).toContain('docs-changed=false\n');
          expect(outputs).toContain('any-code-changed=false\n');
          expect(outputs).not.toContain('mjs-changed=');
          expect(outputs).not.toContain('package-changed=');
          expect(outputs).not.toContain('workflow-changed=');
        } finally {
          rmSync(root, { force: true, recursive: true });
        }
      });
    }
  }

  for (const [filePath, expectedOutput] of [
    ['src/relevant.mjs', 'js-changed=true\n'],
    ['docs/relevant.md', 'docs-changed=true\n'],
  ]) {
    itUnless(sandboxed)(
      `keeps detecting non-ignored ${filePath} changes`,
      () => {
        const root = createChangeFixture(filePath, 'push');

        try {
          const { outputs, result } = runDetectCodeChanges(root, 'push');

          expect(result.status).toBe(0);
          expect(outputs).toContain(expectedOutput);
        } finally {
          rmSync(root, { force: true, recursive: true });
        }
      }
    );
  }

  // git prints repository-root-relative paths, so in the multi-language
  // layout (package.json in js/) the package-relative ignore list matches
  // only after the js/ prefix has been stripped.
  for (const eventName of ['pull_request', 'push']) {
    for (const filePath of [
      'js/examples/demo.mjs',
      'js/.changeset/tidy-cats-shine.md',
      'js/experiments/repro.mjs',
      'js/dev/log/repro.js',
      'js/docs/case-studies/issue-141/repro.md',
    ]) {
      itUnless(sandboxed)(
        `ignores ${filePath} changes on ${eventName} in the multi-language layout`,
        () => {
          const root = createChangeFixture(filePath, eventName, {
            packageRoot: 'js',
          });

          try {
            const { outputs, result } = runDetectCodeChanges(root, eventName);

            expect(result.status).toBe(0);
            expect(outputs).toContain('js-changed=false\n');
            expect(outputs).toContain('docs-changed=false\n');
            expect(outputs).toContain('any-code-changed=false\n');
          } finally {
            rmSync(root, { force: true, recursive: true });
          }
        }
      );
    }
  }

  for (const [filePath, expectedOutputs] of [
    ['js/src/relevant.mjs', ['js-changed=true\n', 'any-code-changed=true\n']],
    ['js/docs/relevant.md', ['docs-changed=true\n']],
    ['.github/workflows/ci.yml', ['any-code-changed=true\n']],
  ]) {
    itUnless(sandboxed)(
      `keeps detecting ${filePath} changes in the multi-language layout`,
      () => {
        const root = createChangeFixture(filePath, 'push', {
          packageRoot: 'js',
        });

        try {
          const { outputs, result } = runDetectCodeChanges(root, 'push');

          expect(result.status).toBe(0);
          for (const expected of expectedOutputs) {
            expect(outputs).toContain(expected);
          }
        } finally {
          rmSync(root, { force: true, recursive: true });
        }
      }
    );
  }

  itUnless(sandboxed)(
    'ignores changes belonging to another language package',
    () => {
      const root = createChangeFixture('rust/Cargo.toml', 'push', {
        packageRoot: 'js',
      });

      try {
        const { outputs, result } = runDetectCodeChanges(root, 'push');

        expect(result.status).toBe(0);
        expect(outputs).toContain('js-changed=false\n');
        expect(outputs).toContain('any-code-changed=false\n');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  );
});

describe('detect-code-changes file types', () => {
  // The pipeline runs shell scripts, publishes type declarations and builds
  // the Dockerfile, so a change to any of them must run the checks.
  for (const eventName of ['pull_request', 'push']) {
    for (const filePath of [
      'scripts/check-pages.sh',
      'src/index.d.ts',
      'Dockerfile',
      'bunfig.toml',
      'tests/fixtures/pages-stub/gh',
    ]) {
      itUnless(sandboxed)(`counts ${filePath} as code on ${eventName}`, () => {
        const root = createChangeFixture(filePath, eventName);

        try {
          const { outputs, result } = runDetectCodeChanges(root, eventName);

          expect(result.status).toBe(0);
          expect(outputs).toContain('any-code-changed=true\n');
        } finally {
          rmSync(root, { force: true, recursive: true });
        }
      });
    }
  }

  itUnless(sandboxed)('does not count a .gitkeep placeholder as code', () => {
    const root = createChangeFixture('assets/.gitkeep', 'push');

    try {
      const { outputs, result } = runDetectCodeChanges(root, 'push');

      expect(result.status).toBe(0);
      expect(outputs).toContain('any-code-changed=false\n');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

// A pull request can carry several commits, and a superseded run may never
// have tested the previous head. These fixtures exercise the push-range
// logic against a stub of the Actions API bound to GITHUB_API_URL, driving
// the real script - offline, no mocking of the code under test.
function createMultiCommitFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'detect-code-changes-push-'));

  runGit(root, ['init', '-b', 'main']);
  runGit(root, ['config', 'user.email', 'ci@example.com']);
  runGit(root, ['config', 'user.name', 'CI Test']);

  writeFileSync(path.join(root, 'package.json'), '{ "name": "fixture" }\n');
  commit(root, 'Initial commit');
  const baseSha = spawnGit(root, ['rev-parse', 'HEAD']);

  runGit(root, ['checkout', '-b', 'feature']);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'feature.mjs'), 'export const x = 1;\n');
  commit(root, 'Add code change');
  const codeSha = spawnGit(root, ['rev-parse', 'HEAD']);

  mkdirSync(path.join(root, 'docs'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'notes.md'), '# Notes\n');
  commit(root, 'Add docs change');
  const headSha = spawnGit(root, ['rev-parse', 'HEAD']);

  runGit(root, ['checkout', 'main']);
  runGit(root, ['merge', '--no-ff', 'feature', '-m', 'Merge pull request']);

  return { root, baseSha, codeSha, headSha };
}

function spawnGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.stdout.trim();
}

function startStubApi(responder) {
  return new Promise((resolve) => {
    const requests = [];
    const server = createServer((req, res) => {
      req.on('end', () => {
        requests.push(req.url);
        responder(req, res);
      });
      req.resume();
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, requests });
    });
  });
}

async function runDetector(root, extraEnv) {
  const outputFile = path.join(root, 'github-output.txt');

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [scriptPath],
      {
        cwd: root,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_OUTPUT: outputFile,
          ...extraEnv,
        },
      },
      (error) => {
        if (error) {
          reject(error);
        }
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      resolve({
        status,
        stdout,
        stderr,
        outputs: readFileSync(outputFile, 'utf8'),
      });
    });
  });
}

function pushRangeEnv(baseSha, beforeSha, afterSha, port) {
  return {
    GITHUB_API_URL: `http://127.0.0.1:${port}`,
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_WORKFLOW_REF:
      'owner/repo/.github/workflows/release.yml@refs/pull/1/merge',
    GITHUB_TOKEN: 'stub-token',
    GITHUB_BASE_SHA: baseSha,
    GITHUB_BEFORE_SHA: beforeSha,
    GITHUB_AFTER_SHA: afterSha,
  };
}

describe('detect-code-changes push ranges', () => {
  itUnless(sandboxed)(
    'covers the whole push when the previous head passed',
    async () => {
      const fixture = createMultiCommitFixture();
      const { server, port, requests } = await startStubApi((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"total_count": 1}');
      });

      try {
        const { status, outputs } = await runDetector(
          fixture.root,
          pushRangeEnv(fixture.baseSha, fixture.baseSha, fixture.headSha, port)
        );

        expect(status).toBe(0);
        expect(outputs).toContain('js-changed=true\n');
        expect(requests).toEqual([
          `/repos/owner/repo/actions/workflows/release.yml/runs?head_sha=${fixture.baseSha}&status=success&per_page=1`,
        ]);
      } finally {
        server.close();
        rmSync(fixture.root, { force: true, recursive: true });
      }
    }
  );

  itUnless(sandboxed)(
    'widens to the full PR diff when the previous head never passed',
    async () => {
      const fixture = createMultiCommitFixture();
      const { server, port, requests } = await startStubApi((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"total_count": 0}');
      });

      try {
        const { status, stdout, outputs } = await runDetector(
          fixture.root,
          pushRangeEnv(fixture.baseSha, fixture.codeSha, fixture.headSha, port)
        );

        expect(status).toBe(0);
        expect(outputs).toContain('js-changed=true\n');
        expect(stdout).toContain('full PR diff');
        expect(requests.length).toBe(1);
      } finally {
        server.close();
        rmSync(fixture.root, { force: true, recursive: true });
      }
    }
  );

  itUnless(sandboxed)('widens when the lookup fails', async () => {
    const fixture = createMultiCommitFixture();
    const { server, port } = await startStubApi((req, res) => {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end('{"message": "Forbidden"}');
    });

    try {
      const { status, outputs } = await runDetector(
        fixture.root,
        pushRangeEnv(fixture.baseSha, fixture.codeSha, fixture.headSha, port)
      );

      expect(status).toBe(0);
      expect(outputs).toContain('js-changed=true\n');
    } finally {
      server.close();
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  itUnless(sandboxed)(
    'keeps the push range when the lookup fails with no base SHA',
    async () => {
      const fixture = createMultiCommitFixture();
      const { server, port } = await startStubApi((req, res) => {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end('{"message": "Forbidden"}');
      });
      const env = pushRangeEnv('', fixture.codeSha, fixture.headSha, port);
      env.GITHUB_BASE_SHA = '';

      try {
        const { status, stdout, outputs } = await runDetector(
          fixture.root,
          env
        );

        expect(status).toBe(0);
        expect(outputs).toContain('js-changed=false\n');
        expect(stdout).toContain(
          `Comparing ${fixture.codeSha} to ${fixture.headSha} (push range)`
        );
      } finally {
        server.close();
        rmSync(fixture.root, { force: true, recursive: true });
      }
    }
  );

  itUnless(sandboxed)(
    'skips the lookup entirely without push SHAs',
    async () => {
      const fixture = createMultiCommitFixture();
      const { server, port, requests } = await startStubApi((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"total_count": 1}');
      });
      const env = pushRangeEnv(
        fixture.baseSha,
        fixture.baseSha,
        fixture.headSha,
        port
      );
      env.GITHUB_BEFORE_SHA = '';
      env.GITHUB_AFTER_SHA = '';

      try {
        const { status, stdout, outputs } = await runDetector(
          fixture.root,
          env
        );

        expect(status).toBe(0);
        expect(outputs).toContain('js-changed=true\n');
        expect(stdout).toContain(`Comparing ${fixture.baseSha} to HEAD^2`);
        expect(requests).toEqual([]);
      } finally {
        server.close();
        rmSync(fixture.root, { force: true, recursive: true });
      }
    }
  );
});
