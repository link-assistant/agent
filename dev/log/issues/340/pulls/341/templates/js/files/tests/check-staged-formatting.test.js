import { describe, expect } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { checkStagedFormatting } from '../scripts/check-staged-formatting.mjs';
import { runCommand } from '../scripts/run-command.mjs';
import { itUnless, sandboxed } from './helpers/skip.js';

const prettier = fileURLToPath(
  new URL('../node_modules/prettier/bin/prettier.cjs', import.meta.url)
);

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
}

describe('staged release formatting', () => {
  itUnless(sandboxed)(
    'checks a formatted file while skipping a consumed changeset deletion',
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'release-format-'));
      try {
        git(cwd, 'init', '-q');
        git(cwd, 'config', 'user.email', 'test@example.com');
        git(cwd, 'config', 'user.name', 'Test');
        mkdirSync(join(cwd, '.changeset'));
        writeFileSync(join(cwd, '.changeset', 'fixed.md'), '# fixed\n');
        writeFileSync(
          join(cwd, 'package.json'),
          '{\n  "version": "1.0.0"\n}\n'
        );
        git(cwd, 'add', '-A');
        git(cwd, 'commit', '-qm', 'initial');
        git(cwd, 'rm', '-q', '.changeset/fixed.md');
        writeFileSync(
          join(cwd, 'package.json'),
          '{\n  "version": "1.0.1"\n}\n'
        );
        git(cwd, 'add', 'package.json');

        const checked = await checkStagedFormatting({
          cwd,
          logger: { log() {} },
          runner: (command, args, options) =>
            command === 'npx'
              ? runCommand(
                  process.execPath,
                  [prettier, ...args.slice(2)],
                  options
                )
              : runCommand(command, args, options),
        });
        expect(checked).toEqual(['package.json']);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  );
});
