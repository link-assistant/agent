/** Tests for safe, fail-closed release-time changeset merging. */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { describe, expect } from 'test-anywhere';
import { itUnless, sandboxed } from './helpers/skip.js';

const scriptPath = fileURLToPath(
  new URL('../scripts/merge-changesets.mjs', import.meta.url)
);

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'merge-changesets-'));
  const changesetDir = path.join(root, '.changeset');

  mkdirSync(changesetDir, { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture-package',
      version: '1.0.0',
    })
  );

  return { changesetDir, root };
}

function writeChangeset(changesetDir, fileName, content) {
  writeFileSync(path.join(changesetDir, fileName), content);
}

function runMergeChangesets(root, extraEnv = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}

describe('merge-changesets.mjs', () => {
  itUnless(sandboxed)(
    'fails without merging when any changeset has an unparseable bump type',
    () => {
      const { changesetDir, root } = createFixture();

      try {
        writeChangeset(
          changesetDir,
          'valid.md',
          `---
'fixture-package': patch
---

Keep this release note.
`
        );
        writeChangeset(
          changesetDir,
          'malformed.md',
          `---
'fixture-package': patches
---

This note must not be silently dropped.
`
        );

        const result = runMergeChangesets(root);
        const output = `${result.stdout}\n${result.stderr}`;

        expect(result.status).not.toBe(0);
        expect(output).toContain('Could not parse version type');
        expect(output).toContain('malformed.md');
        expect(existsSync(path.join(changesetDir, 'valid.md'))).toBe(true);
        expect(existsSync(path.join(changesetDir, 'malformed.md'))).toBe(true);
        expect(
          readdirSync(changesetDir).filter((file) => file.endsWith('.md'))
            .length
        ).toBe(2);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed)(
    'brackets contributor-authored descriptions as untrusted Actions output',
    () => {
      const { changesetDir, root } = createFixture();

      try {
        writeChangeset(
          changesetDir,
          'first.md',
          `---
'fixture-package': patch
---

##[error] forged annotation
`
        );
        writeChangeset(
          changesetDir,
          'second.md',
          `---
'fixture-package': patch
---

ordinary release note
`
        );

        const result = runMergeChangesets(root, { GITHUB_ACTIONS: 'true' });
        const stop = result.stdout.indexOf('::stop-commands::');
        const payload = result.stdout.indexOf('##[error] forged annotation');
        const resume = result.stdout.indexOf('::\n', payload);

        expect(result.status).toBe(0);
        expect(stop).toBeGreaterThan(-1);
        expect(payload).toBeGreaterThan(stop);
        expect(resume).toBeGreaterThan(payload);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});
