#!/usr/bin/env node

// Run the same pinned scanner as CI against finite, synthetic fixtures.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const fixtures = mkdtempSync(join(tmpdir(), 'issue-212-secretlint-'));
const cases = [
  { name: 'clean', text: 'This file has no credentials.\n', status: 0 },
  { name: 'github', text: `ghp_${'A'.repeat(36)}\n`, status: 1 },
  {
    name: 'slack',
    text: `xoxb-${'1'.repeat(12)}-${'2'.repeat(12)}-${'a'.repeat(24)}\n`,
    status: 1,
  },
];
try {
  for (const fixture of cases) {
    const path = join(fixtures, `${fixture.name}.txt`);
    writeFileSync(path, fixture.text);
    const result = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      [
        '--yes',
        '-p',
        'secretlint@13.0.7',
        '-p',
        '@secretlint/secretlint-rule-preset-recommend@13.0.7',
        'secretlint',
        '--secretlintrc',
        resolve('.secretlintrc.json'),
        path,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(
      result.status,
      fixture.status,
      `${fixture.name}: ${result.stderr || result.stdout || result.error}`
    );
    console.log(`${fixture.name}: expected scanner exit ${result.status}`);
  }
} finally {
  rmSync(fixtures, { recursive: true, force: true });
}
