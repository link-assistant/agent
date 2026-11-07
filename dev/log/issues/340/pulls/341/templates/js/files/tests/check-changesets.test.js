/**
 * Tests for check-changesets.mjs CLI behavior.
 * stray Markdown docs in .changeset must not count as
 * pending release changesets.
 */

import { describe, expect } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { itUnless, sandboxed } from './helpers/skip.js';

const scriptPath = fileURLToPath(
  new URL('../scripts/check-changesets.mjs', import.meta.url)
);

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'check-changesets-'));
  mkdirSync(path.join(root, '.changeset'), { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: '@scope/fixture-package',
      version: '1.0.0',
    })
  );

  return root;
}

function runCheckChangesets(root) {
  const outputFile = path.join(root, 'github-output.txt');
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputFile,
    },
  });

  return {
    outputFile,
    result,
  };
}

describe('check-changesets CLI', () => {
  itUnless(sandboxed)(
    'ignores stray Markdown files without valid changeset frontmatter',
    () => {
      const root = createFixture();

      try {
        writeFileSync(
          path.join(root, '.changeset', 'NOTES.md'),
          '# Release notes draft\n\nThis is project documentation, not a changeset.\n'
        );

        const { outputFile, result } = runCheckChangesets(root);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Found 0 changeset file(s)');
        expect(readFileSync(outputFile, 'utf8')).toBe(
          'has_changesets=false\nchangeset_count=0\n'
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  );

  itUnless(sandboxed)(
    'counts Markdown files with a recognized package bump in frontmatter',
    () => {
      const root = createFixture();

      try {
        writeFileSync(
          path.join(root, '.changeset', 'valid-change.md'),
          `---
'@scope/fixture-package': patch
---

Fix the fixture behavior.
`
        );

        const { outputFile, result } = runCheckChangesets(root);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Found 1 changeset file(s)');
        expect(readFileSync(outputFile, 'utf8')).toBe(
          'has_changesets=true\nchangeset_count=1\n'
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  );

  itUnless(sandboxed)(
    'ignores changeset frontmatter for an unknown package',
    () => {
      const root = createFixture();

      try {
        writeFileSync(
          path.join(root, '.changeset', 'other-package.md'),
          `---
'other-package': minor
---

Update another package.
`
        );

        const { outputFile, result } = runCheckChangesets(root);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Found 0 changeset file(s)');
        expect(readFileSync(outputFile, 'utf8')).toBe(
          'has_changesets=false\nchangeset_count=0\n'
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  );
});
