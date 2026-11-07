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
import { itUnless, noPosixShell, sandboxed } from './helpers/skip.js';

const scriptPath = fileURLToPath(
  new URL('../scripts/check-file-line-limits.sh', import.meta.url)
);

function lines(count) {
  return `${Array.from({ length: count }, (_, index) => `line-${index + 1}`).join('\n')}\n`;
}

// The check walks `git ls-files`, so a fixture is a real git repository
// with everything indexed; untracked files are out of scope by design.
function createFixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'line-limit-'));

  for (const [filePath, lineCount] of Object.entries(files)) {
    const absolutePath = path.join(root, filePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, lines(lineCount));
  }

  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });

  return root;
}

function runLineLimitCheck(root, env) {
  return spawnSync('bash', [scriptPath], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
}

describe('check-file-line-limits.sh scope', () => {
  it('walks the tracked file list and refuses to pass on an empty walk', () => {
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('LIMIT=1500');
    expect(script).toContain('WARN_THRESHOLD=1350');
    expect(script).toContain("EXTENSIONS='js|mjs|cjs|md|yml|yaml'");
    expect(script).toContain('git ls-files -z');
    expect(script).toContain('git rev-parse --show-toplevel');
    expect(script).toContain('this check verified nothing');
    expect(script).not.toContain('find .');
    // String accumulators, not arrays: ${#empty[@]} under set -u is an
    // unbound variable on bash 3.2 (macOS).
    expect(script).not.toContain('FAILURES=()');
    expect(script).toContain('WARNINGS=');
    expect(script).toContain('::warning file=');
  });
});

describe('check-file-line-limits.sh', () => {
  itUnless(sandboxed, noPosixShell)(
    'warns without failing for files above the warning threshold',
    () => {
      const root = createFixture({
        'src/near-limit.mjs': 1351,
        '.github/workflows/release.yml': 1351,
      });

      try {
        const result = runLineLimitCheck(root);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(
          'WARNING: src/near-limit.mjs has 1351 lines'
        );
        expect(result.stdout).toContain(
          'WARNING: .github/workflows/release.yml has 1351 lines'
        );
        expect(result.stdout).toContain(
          'The following files are approaching the 1500 line limit (>1350 lines):'
        );
        expect(result.stdout).toContain('  src/near-limit.mjs');
        expect(result.stdout).toContain('  .github/workflows/release.yml');
        expect(result.stdout).not.toContain(
          'The following files exceed the 1500 line limit:'
        );
        expect(result.stdout).toContain('Checked 2 tracked files');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'still fails files over the hard limit',
    () => {
      const root = createFixture({
        'src/too-large.mjs': 1501,
      });

      try {
        const result = runLineLimitCheck(root);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain(
          'ERROR: src/too-large.mjs has 1501 lines (limit: 1500)'
        );
        expect(result.stdout).toContain(
          'The following files exceed the 1500 line limit:'
        );
        expect(result.stdout).toContain('  src/too-large.mjs');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'fails .js and .cjs files over the hard limit',
    () => {
      const root = createFixture({
        'src/too-large.js': 1501,
        'src/legacy.cjs': 1600,
      });

      try {
        const result = runLineLimitCheck(root);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain(
          'ERROR: src/too-large.js has 1501 lines (limit: 1500)'
        );
        expect(result.stdout).toContain(
          'ERROR: src/legacy.cjs has 1600 lines (limit: 1500)'
        );
        expect(result.stdout).toContain(
          'The following files exceed the 1500 line limit:'
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'fails Markdown files over the hard limit',
    () => {
      const root = createFixture({
        'docs/HUGE.md': 1501,
      });

      try {
        const result = runLineLimitCheck(root);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain(
          'ERROR: docs/HUGE.md has 1501 lines (limit: 1500)'
        );
        expect(result.stdout).toContain(
          'The following files exceed the 1500 line limit:'
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  // release.yml was the one file this gate was written for; a rename to
  // .yaml used to be reported as a WARNING inside an exiting-0 step.
  itUnless(sandboxed, noPosixShell)(
    'fails workflow files under any name, including .yaml',
    () => {
      const root = createFixture({
        '.github/workflows/release.yaml': 1501,
        'README.md': 1,
      });

      try {
        const result = runLineLimitCheck(root);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain(
          'ERROR: .github/workflows/release.yaml has 1501 lines (limit: 1500)'
        );
        expect(result.stdout).toContain(
          'Move inline scripts to the ./scripts/ folder to reduce file size.'
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'exempts case-study generated-data files from the limit',
    () => {
      const root = createFixture({
        'docs/case-studies/issue-99/data/raw.md': 5000,
        'docs/case-studies/issue-99/data/sample.cjs': 5000,
        'docs/case-studies/issue-99/data/external.yml': 5000,
        'README.md': 1,
      });

      try {
        const result = runLineLimitCheck(root);

        expect(result.status).toBe(0);
        expect(result.stdout).not.toContain(
          'The following files exceed the 1500 line limit:'
        );
        expect(result.stdout).not.toContain('data/raw.md');
        expect(result.stdout).not.toContain('data/sample.cjs');
        expect(result.stdout).not.toContain('data/external.yml');
        expect(result.stdout).toContain('Checked 1 tracked files');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});

// What the walk covers: exemptions, the tracked-file boundary, and the
// "examined nothing" refusals.
describe('check-file-line-limits.sh walk', () => {
  itUnless(sandboxed, noPosixShell)(
    'never checks git-ignored build output',
    () => {
      const root = mkdtempSync(path.join(tmpdir(), 'line-limit-'));
      mkdirSync(path.join(root, 'dist'), { recursive: true });
      writeFileSync(path.join(root, '.gitignore'), 'dist/\n');
      writeFileSync(path.join(root, 'README.md'), 'ok\n');
      writeFileSync(path.join(root, 'dist/bundle.js'), lines(1600));
      spawnSync('git', ['init', '-q'], { cwd: root });
      spawnSync('git', ['add', '-A'], { cwd: root });

      try {
        const result = runLineLimitCheck(root);

        expect(result.status).toBe(0);
        expect(result.stdout).not.toContain('dist/bundle.js');
        expect(result.stdout).toContain('Checked 1 tracked files');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'exits 2 with an error when it examined nothing',
    () => {
      const root = mkdtempSync(path.join(tmpdir(), 'line-limit-'));
      writeFileSync(path.join(root, 'only.txt'), 'not a matched extension\n');
      spawnSync('git', ['init', '-q'], { cwd: root });
      spawnSync('git', ['add', '-A'], { cwd: root });

      try {
        const result = runLineLimitCheck(root);

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('no tracked files matched');
        expect(result.stderr).toContain('this check verified nothing');
        expect(result.stdout).not.toContain('All checked files are within');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed, noPosixShell)('exits 2 outside a git repository', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'line-limit-'));
    writeFileSync(path.join(root, 'README.md'), 'ok\n');

    try {
      const result = runLineLimitCheck(root);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('not inside a git repository');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  itUnless(sandboxed, noPosixShell)(
    'normalizes padded wc output from BSD-like environments',
    () => {
      const root = createFixture({
        'src/near-limit.mjs': 1351,
      });
      const binPath = path.join(root, 'bin');
      const fakeWcPath = path.join(binPath, 'wc');

      try {
        mkdirSync(binPath, { recursive: true });
        writeFileSync(
          fakeWcPath,
          `#!/bin/sh
awk 'END { printf "    %d\\n", NR }'
`
        );
        chmodSync(fakeWcPath, 0o755);

        const result = runLineLimitCheck(root, {
          ...process.env,
          PATH: `${binPath}${path.delimiter}${process.env.PATH ?? ''}`,
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(
          'WARNING: src/near-limit.mjs has 1351 lines'
        );
        expect(result.stdout).not.toContain('has     1351 lines');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});
