import { describe, it, expect } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { itUnless, noPosixShell, sandboxed } from './helpers/skip.js';

const scriptPath = fileURLToPath(
  new URL('../scripts/check-required-docs.sh', import.meta.url)
);
const readme = readFileSync('README.md', 'utf8');

function listRequirements() {
  const result = spawnSync('bash', [scriptPath, '--list'], {
    encoding: 'utf8',
  });

  expect(result.status).toBe(0);

  return result.stdout
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [file, section] = line.split('\t');
      return { file, section: section ?? null };
    });
}

function runCheck(root) {
  return spawnSync('bash', [scriptPath], {
    cwd: root,
    encoding: 'utf8',
  });
}

describe('check-required-docs.sh', () => {
  it('requires sections, matched as whole heading lines', () => {
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('grep -Fxq');
    expect(script).toContain('REQUIREMENTS=(');
    expect(script).toContain('--list');
    // bash 3.2 treats ${#empty[@]} under set -u as an unbound variable,
    // so the failure list must be a string accumulator.
    expect(script).not.toContain('FAILURES=()');
    expect(script).toContain("FAILURES=''");
  });

  itUnless(sandboxed, noPosixShell)(
    'builds its fixtures from the same table the check reads',
    () => {
      const requirements = listRequirements();
      const files = [...new Set(requirements.map((entry) => entry.file))];

      expect(files.sort()).toEqual([
        'CHANGELOG.md',
        'README.md',
        'docs/BEST-PRACTICES.md',
        'docs/CONTRIBUTING.md',
      ]);

      // Every required file+section pair must exist in this repository, so
      // the shipped gate is green on the template itself.
      for (const { file, section } of requirements) {
        const content = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');

        if (section !== null) {
          expect(content).toContain(`## ${section}\n`);
        }
      }
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'pins the sections a reader of the README depends on',
    () => {
      const requirements = listRequirements();
      const readmeSections = requirements
        .filter((entry) => entry.file === 'README.md')
        .map((entry) => entry.section);

      expect(readmeSections).toContain('Quick Start');
      expect(readmeSections).toContain('License');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'passes on the repository as shipped',
    () => {
      const result = runCheck(process.cwd());

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'All documentation requirements satisfied (4 documents checked).'
      );
    }
  );

  // The check resolves the repository root before reading anything, so
  // every fixture is a (bare) git repository.
  function createRepoFixture(files) {
    const root = mkdtempSync(path.join(tmpdir(), 'required-docs-'));

    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(root, name), content);
    }

    spawnSync('git', ['init', '-q'], { cwd: root });

    return root;
  }

  itUnless(sandboxed, noPosixShell)(
    'fails when a required section is deleted but the file remains',
    () => {
      const gutted = readme.split('\n## ')[0];
      const root = createRepoFixture({
        'README.md': gutted,
        'CHANGELOG.md': '# Changelog\n',
        'BEST-PRACTICES.md': '# placeholder\n',
      });

      try {
        const result = runCheck(root);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain(
          "README.md is missing the required '## Quick Start' section"
        );
        expect(result.stdout).toContain(
          'documentation requirement(s) violated'
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'is not fooled by a table-of-contents mention of a section',
    () => {
      const root = createRepoFixture({
        'README.md': '- See the Quick Start section below\n',
        'CHANGELOG.md': '# Changelog\n',
      });

      try {
        const result = runCheck(root);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain("'## Quick Start' is missing");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'fails a missing required document with its own message',
    () => {
      const root = createRepoFixture({ 'README.md': readme });

      try {
        const result = runCheck(root);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain(
          'required document docs/CONTRIBUTING.md is missing'
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});
